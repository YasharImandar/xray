import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  ConfigProvider,
  Descriptions,
  Input,
  Layout,
  Popconfirm,
  Result,
  Row,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CopyOutlined,
  DeleteOutlined,
  GlobalOutlined,
  LinkOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined,
  SwapOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';

import { ClipboardManager, HttpUtil, SizeFormatter } from '@/utils';
import { parseMsg } from '@/utils/zodValidate';
import { useTheme } from '@/hooks/useTheme';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useStatusQuery } from '@/api/queries/useStatusQuery';
import { keys } from '@/api/queryKeys';
import {
  ExtensionMonitorSnapshotSchema,
  type ExtensionClientRow,
  type ExtensionLogEntry,
  type ExtensionMonitorSnapshot,
} from '@/schemas/monitoring';
import AppSidebar from '@/layouts/AppSidebar';
import '@/pages/index/IndexPage.css';
import './MonitoringPage.css';
import ActivityChart from './ActivityChart';
import RankedList, { type RankedItem } from './RankedList';
import {
  asNumber,
  asText,
  compactNumber,
  countryFlag,
  formatAgo,
  formatLastSeen,
  formatWhen,
  shortHost,
} from './format';

const POLL_MS = 3000;
const LOG_COUNT = 400;
const LOG_PAGE_SIZES = [20, 50, 100, 200, 400];
const CLIENT_PAGE_SIZES = [10, 25, 50, 100];

const XRAY_STATE_KEYS: Record<string, string> = {
  running: 'pages.index.xrayStatusRunning',
  stop: 'pages.index.xrayStatusStop',
  error: 'pages.index.xrayStatusError',
};

const EVENT_COLOR: Record<string, string> = {
  direct: 'green',
  blocked: 'red',
  proxy: 'blue',
};

async function fetchExtensionMonitor(filter: string): Promise<ExtensionMonitorSnapshot> {
  const msg = await HttpUtil.get(
    '/panel/api/server/extensionMonitor',
    { count: LOG_COUNT, filter },
    { silent: true },
  );
  if (!msg?.success) throw new Error(msg?.msg || 'Failed to fetch extension monitor');
  const validated = parseMsg(msg, ExtensionMonitorSnapshotSchema, 'server/extensionMonitor');
  if (!validated.obj) throw new Error('Failed to fetch extension monitor');
  return validated.obj;
}

function Kpi({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone?: 'ok' | 'warn';
}) {
  return (
    <div className={`mon-kpi${tone ? ` is-${tone}` : ''}`}>
      <span className="mon-kpi-icon">{icon}</span>
      <span className="mon-kpi-body">
        <span className="mon-kpi-label">{label}</span>
        <span className="mon-kpi-value">{value}</span>
        {hint && <span className="mon-kpi-hint">{hint}</span>}
      </span>
    </div>
  );
}

function CountryBeside({ country, countryCode }: { country?: string; countryCode?: string }) {
  const name = asText(country);
  const flag = countryFlag(countryCode);
  if (!flag && !name) return null;
  return (
    <span className="mon-country">
      {flag ? `${flag} ` : ''}
      {name || asText(countryCode).toUpperCase()}
    </span>
  );
}

export default function MonitoringPage() {
  const { t } = useTranslation();
  const [messageApi, messageContextHolder] = message.useMessage();
  const { isDark, isUltra, antdThemeConfig } = useTheme();
  const { isMobile } = useMediaQuery();
  const { status } = useStatusQuery();
  const [filter, setFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [paused, setPaused] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [logPage, setLogPage] = useState(1);
  const [logPageSize, setLogPageSize] = useState(20);
  const [clientPage, setClientPage] = useState(1);
  const [clientPageSize, setClientPageSize] = useState(10);

  const monitorQuery = useQuery({
    queryKey: keys.server.extensionMonitor(LOG_COUNT, filter),
    queryFn: () => fetchExtensionMonitor(filter),
    refetchInterval: paused ? false : POLL_MS,
  });

  const snapshot = monitorQuery.data;
  const inbound = snapshot?.inbound;
  const logs = snapshot?.logs ?? [];
  const clients = snapshot?.clients ?? [];
  const topDests = snapshot?.topDests ?? [];
  const countries = snapshot?.countries ?? [];
  const timeline = snapshot?.timeline ?? [];
  const stats = snapshot?.stats;
  const xrayStateText = t(XRAY_STATE_KEYS[status.xray.state] ?? 'pages.index.xrayStatusUnknown');
  const pageClass =
    `monitoring-page ${isDark ? 'is-dark' : ''} ${isUltra ? 'is-ultra' : ''}`.trim();

  // An HTTP inbound has no accounts and no per-client counters, so the columns
  // that depend on them would be a screenful of identical or empty cells.
  const namedClients = clients.some((row) => asText(row.email) !== '');
  const namedLogs = logs.some((row) => asText(row.email) !== '');
  const clientTraffic = clients.some(
    (row) => asNumber(row.up) > 0 || asNumber(row.down) > 0 || asNumber(row.total) > 0,
  );
  const anyRejected = asNumber(stats?.rejected) > 0;
  const anyNetwork = logs.some((row) => asText(row.network) !== '');

  function applyFilter(value: string) {
    const next = value.trim();
    setFilter(next);
    setSearchText(next);
    setLogPage(1);
    setClientPage(1);
  }

  // Copies the raw lines the snapshot holds, oldest first, so a filtered view
  // yields exactly the matching lines a log file would.
  async function copyLog() {
    const text = logs
      .map((row) => asText(row.raw))
      .filter(Boolean)
      .join('\n');
    if (!text) return;
    if (await ClipboardManager.copyText(text)) messageApi.success(t('copied'));
  }

  const siteItems: RankedItem[] = topDests.map((dest) => ({
    key: `${asText(dest.host)}:${asText(dest.port)}`,
    label: shortHost(asText(dest.url) || asText(dest.host)),
    meta: t('pages.monitoring.siteClients', { count: asNumber(dest.clients) }),
    value: asNumber(dest.hits),
    warn: asNumber(dest.rejected),
    title: asText(dest.host),
  }));

  const countryItems: RankedItem[] = countries.map((country) => ({
    key: asText(country.code),
    label:
      `${countryFlag(asText(country.code))} ${asText(country.name) || asText(country.code)}`.trim(),
    meta: t('pages.monitoring.countryHits', { count: asNumber(country.hits) }),
    value: asNumber(country.clients),
    title: asText(country.name),
  }));

  const clientColumns: ColumnsType<ExtensionClientRow> = [
    {
      title: namedClients ? t('pages.monitoring.user') : t('pages.monitoring.clientIp'),
      key: 'user',
      ellipsis: true,
      sorter: (a, b) =>
        Number(Boolean(b.online)) - Number(Boolean(a.online)) ||
        asNumber(b.lastOnline) - asNumber(a.lastOnline),
      defaultSortOrder: 'ascend',
      render: (_, row) => {
        const identity = asText(row.email) || asText(row.user) || asText(row.clientIp);
        return (
          <Space size={6}>
            <Tag color={row.online ? 'green' : 'default'}>
              {row.online ? t('online') : t('offline')}
            </Tag>
            <button
              type="button"
              className="mon-link"
              title={t('pages.monitoring.filterBy', { value: identity })}
              onClick={() => applyFilter(identity)}
            >
              {identity || t('none')}
            </button>
            <CountryBeside country={asText(row.country)} countryCode={asText(row.countryCode)} />
          </Space>
        );
      },
    },
    ...(namedClients
      ? ([
          {
            title: t('pages.monitoring.clientIp'),
            dataIndex: 'clientIp',
            width: 200,
            render: (ip: string | undefined, row) => {
              const addr = asText(ip);
              if (!addr) return t('none');
              return (
                <Space size={6} wrap>
                  <Typography.Text copyable={{ text: addr }}>{addr}</Typography.Text>
                  <CountryBeside
                    country={asText(row.country)}
                    countryCode={asText(row.countryCode)}
                  />
                </Space>
              );
            },
          },
        ] satisfies ColumnsType<ExtensionClientRow>)
      : []),
    {
      title: t('pages.monitoring.hits'),
      dataIndex: 'hits',
      width: 96,
      align: 'right',
      sorter: (a, b) => asNumber(a.hits) - asNumber(b.hits),
      render: (hits: number | undefined) => compactNumber(asNumber(hits)),
    },
    ...(anyRejected
      ? ([
          {
            title: t('pages.monitoring.rejected'),
            dataIndex: 'rejected',
            width: 96,
            align: 'right',
            sorter: (a, b) => asNumber(a.rejected) - asNumber(b.rejected),
            render: (n: number | undefined) =>
              asNumber(n) > 0 ? (
                <Typography.Text type="danger">{asNumber(n)}</Typography.Text>
              ) : (
                '—'
              ),
          },
        ] satisfies ColumnsType<ExtensionClientRow>)
      : []),
    {
      title: t('pages.monitoring.lastDest'),
      key: 'lastDest',
      ellipsis: true,
      render: (_, row) => {
        const dest = asText(row.lastURL) || asText(row.lastDest);
        if (!dest) return t('none');
        return (
          <button
            type="button"
            className="mon-link"
            title={t('pages.monitoring.filterBy', { value: shortHost(dest) })}
            onClick={() => applyFilter(shortHost(dest).split('/')[0])}
          >
            {shortHost(dest)}
          </button>
        );
      },
    },
    {
      title: t('pages.monitoring.recentDests'),
      key: 'recentDests',
      ellipsis: true,
      responsive: ['lg'],
      render: (_, row) => {
        const dests = Array.isArray(row.recentDests) ? row.recentDests.filter(Boolean) : [];
        if (dests.length === 0) return t('none');
        return (
          <Tooltip title={dests.map(shortHost).join('\n')}>
            <span className="mon-chips">
              {dests.slice(0, 3).map((dest) => (
                <Tag key={dest} bordered={false}>
                  {shortHost(dest)}
                </Tag>
              ))}
            </span>
          </Tooltip>
        );
      },
    },
    ...(clientTraffic
      ? ([
          {
            title: t('pages.inbounds.traffic'),
            key: 'traffic',
            width: 180,
            sorter: (a, b) =>
              asNumber(a.up) + asNumber(a.down) - (asNumber(b.up) + asNumber(b.down)),
            render: (_, row) =>
              `${SizeFormatter.sizeFormat(asNumber(row.up))} ↑ · ${SizeFormatter.sizeFormat(asNumber(row.down))} ↓`,
          },
        ] satisfies ColumnsType<ExtensionClientRow>)
      : []),
    {
      title: t('lastOnline'),
      dataIndex: 'lastOnline',
      width: 110,
      align: 'right',
      sorter: (a, b) => asNumber(a.lastOnline) - asNumber(b.lastOnline),
      render: (ts: number | undefined) => (
        <Tooltip title={formatLastSeen(ts, t('none'))}>
          <span>{formatAgo(ts, t('none'))}</span>
        </Tooltip>
      ),
    },
  ];

  const logColumns: ColumnsType<ExtensionLogEntry> = [
    {
      title: t('pages.monitoring.details'),
      dataIndex: 'time',
      width: isMobile ? 110 : 170,
      sorter: (a, b) =>
        new Date(asText(a.time)).getTime() - new Date(asText(b.time)).getTime() || 0,
      render: (value: string | undefined) => formatWhen(value, t('none')),
    },
    ...(namedLogs
      ? ([
          {
            title: t('pages.monitoring.user'),
            dataIndex: 'email',
            ellipsis: true,
            render: (email: string | undefined) => {
              const user = asText(email);
              return user ? <Typography.Text copyable>{user}</Typography.Text> : t('none');
            },
          },
        ] satisfies ColumnsType<ExtensionLogEntry>)
      : []),
    {
      title: t('pages.monitoring.clientIp'),
      key: 'client',
      width: 220,
      render: (_, row) => {
        const ip = asText(row.clientIp);
        if (!ip) return t('none');
        return (
          <Space size={6} wrap>
            <button
              type="button"
              className="mon-link"
              title={t('pages.monitoring.filterBy', { value: ip })}
              onClick={() => applyFilter(ip)}
            >
              {ip}
            </button>
            <CountryBeside country={asText(row.country)} countryCode={asText(row.countryCode)} />
          </Space>
        );
      },
    },
    {
      title: t('pages.monitoring.destUrl'),
      dataIndex: 'url',
      ellipsis: true,
      render: (url: string | undefined, row) => {
        const dest = asText(url) || asText(row.destAddress);
        if (!dest) return t('none');
        return (
          <Space size={6}>
            <Typography.Text copyable={{ text: dest }} className="mon-dest">
              {shortHost(dest)}
            </Typography.Text>
          </Space>
        );
      },
    },
    ...(anyNetwork
      ? ([
          {
            title: t('pages.monitoring.network'),
            dataIndex: 'network',
            width: 80,
            render: (network: string | undefined) => (network ? network.toUpperCase() : t('none')),
          },
        ] satisfies ColumnsType<ExtensionLogEntry>)
      : []),
    {
      title: t('status'),
      dataIndex: 'status',
      width: 110,
      render: (value: string | undefined) => (
        <Tag color={value === 'rejected' ? 'red' : 'green'}>
          {value === 'rejected' ? t('pages.monitoring.rejected') : t('pages.monitoring.accepted')}
        </Tag>
      ),
    },
    {
      title: t('pages.index.accessProxy'),
      dataIndex: 'event',
      width: 100,
      render: (event: string | undefined) => (
        <Tag color={EVENT_COLOR[event ?? ''] ?? 'default'}>{(event || 'proxy').toUpperCase()}</Tag>
      ),
    },
  ];

  const expandedLog = useMemo(
    () => (row: ExtensionLogEntry) => (
      <Descriptions
        size="small"
        bordered
        column={isMobile ? 1 : 2}
        className="mon-log-details"
        items={[
          ...(asText(row.email)
            ? [{ label: t('pages.monitoring.user'), children: asText(row.email) }]
            : []),
          { label: t('pages.monitoring.destUrl'), children: asText(row.url) || t('none') },
          { label: t('pages.monitoring.destHost'), children: asText(row.destHost) || t('none') },
          { label: t('pages.monitoring.destPort'), children: asText(row.destPort) || t('none') },
          { label: t('pages.monitoring.packet'), children: asText(row.packet) || t('none') },
          { label: t('pages.monitoring.network'), children: asText(row.network) || t('none') },
          { label: t('pages.monitoring.clientIp'), children: asText(row.clientIp) || t('none') },
          {
            label: t('pages.monitoring.country'),
            children: asText(row.country)
              ? `${countryFlag(asText(row.countryCode))} ${asText(row.country)}`.trim()
              : t('none'),
          },
          { label: t('pages.monitoring.inboundTag'), children: asText(row.inbound) || t('none') },
          { label: t('pages.monitoring.outbound'), children: asText(row.outbound) || t('none') },
          {
            label: t('pages.monitoring.rawLog'),
            span: 2,
            children: (
              <Typography.Paragraph copyable className="mon-raw">
                {asText(row.raw)}
              </Typography.Paragraph>
            ),
          },
        ]}
      />
    ),
    [isMobile, t],
  );

  const logCount = asNumber(stats?.logCount, logs.length);
  const eventCount = asNumber(stats?.eventCount, logs.length);

  return (
    <ConfigProvider theme={antdThemeConfig}>
      <Layout className={pageClass}>
        <AppSidebar />
        <Layout className="content-shell">
          <Layout.Content id="content-layout" className="content-area">
            <div className="mon-page">
              {messageContextHolder}
              <div className="mon-bar">
                <Typography.Title level={4} className="mon-title">
                  {t('pages.monitoring.title')}
                </Typography.Title>
                <span className={`mon-live${paused ? ' is-paused' : ''}`}>
                  <span className="mon-live-dot" />
                  {paused ? t('pages.monitoring.pause') : t('pages.monitoring.live')}
                </span>
                <span className="ov-state" data-state={status.xray.state}>
                  <span className="ov-state-dot" />
                  {xrayStateText}
                  {status.xray.version && status.xray.version !== 'Unknown'
                    ? ` · ${t('pages.monitoring.xrayVersion', { version: status.xray.version })}`
                    : ''}
                </span>
                {inbound && (
                  <Tag color={inbound.enable === false ? 'default' : 'processing'}>
                    {inbound.remark || t('pages.monitoring.extensionInbound')} · {inbound.port}
                  </Tag>
                )}
                <Space className="mon-actions">
                  <Button
                    size="small"
                    icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
                    onClick={() => setPaused((v) => !v)}
                  >
                    {paused ? t('pages.monitoring.resume') : t('pages.monitoring.pause')}
                  </Button>
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    loading={monitorQuery.isFetching}
                    onClick={() => void monitorQuery.refetch()}
                  >
                    {t('refresh')}
                  </Button>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    disabled={logs.length === 0}
                    onClick={() => void copyLog()}
                  >
                    {t('pages.monitoring.copyLog')}
                  </Button>
                  <Popconfirm
                    title={t('pages.monitoring.clearLogsConfirm')}
                    okType="danger"
                    okText={t('pages.monitoring.clearLogs')}
                    cancelText={t('cancel')}
                    onConfirm={async () => {
                      setClearing(true);
                      try {
                        const msg = await HttpUtil.post('/panel/api/server/clearExtensionLogs');
                        if (msg?.success) await monitorQuery.refetch();
                      } finally {
                        setClearing(false);
                      }
                    }}
                  >
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      loading={clearing}
                      disabled={snapshot?.accessLogEnabled === false}
                    >
                      {t('pages.monitoring.clearLogs')}
                    </Button>
                  </Popconfirm>
                </Space>
              </div>

              {monitorQuery.isError ? (
                <Result
                  status="error"
                  title={t('somethingWentWrong')}
                  subTitle={monitorQuery.error instanceof Error ? monitorQuery.error.message : ''}
                  extra={
                    <Button type="primary" onClick={() => void monitorQuery.refetch()}>
                      {t('refresh')}
                    </Button>
                  }
                />
              ) : snapshot && !snapshot.found ? (
                <Result
                  status="warning"
                  title={t('pages.monitoring.extensionMissing')}
                  subTitle={t('pages.monitoring.extensionMissingHint')}
                />
              ) : (
                <>
                  {snapshot && snapshot.accessLogEnabled === false && (
                    <Alert
                      type="warning"
                      showIcon
                      className="mon-alert"
                      message={t('pages.monitoring.accessLogOff')}
                    />
                  )}

                  <div className="mon-filterbar">
                    <Input.Search
                      allowClear
                      value={searchText}
                      placeholder={t('pages.monitoring.searchPlaceholder')}
                      onChange={(e) => setSearchText(e.target.value)}
                      onSearch={applyFilter}
                      style={{ width: isMobile ? '100%' : 340 }}
                    />
                    {filter && (
                      <Tag closable color="processing" onClose={() => applyFilter('')}>
                        {t('pages.monitoring.filteredBy', { value: filter })}
                      </Tag>
                    )}
                    <Typography.Text type="secondary" className="mon-hint">
                      {t('pages.monitoring.sniffHint')}
                    </Typography.Text>
                  </div>

                  <div className="mon-kpis">
                    <Kpi
                      label={t('pages.monitoring.eventCount')}
                      value={compactNumber(eventCount)}
                      hint={t('pages.monitoring.wholeLog')}
                      icon={<ThunderboltOutlined />}
                    />
                    <Kpi
                      label={t('pages.monitoring.uniqueIps')}
                      value={compactNumber(asNumber(stats?.uniqueIps, clients.length))}
                      icon={<TeamOutlined />}
                    />
                    <Kpi
                      label={t('pages.monitoring.onlineClients')}
                      value={compactNumber(asNumber(stats?.online))}
                      hint={t('pages.monitoring.onlineWindow')}
                      icon={<LinkOutlined />}
                      tone="ok"
                    />
                    <Kpi
                      label={t('pages.monitoring.uniqueDests')}
                      value={compactNumber(asNumber(stats?.uniqueDests))}
                      icon={<GlobalOutlined />}
                    />
                    <Kpi
                      label={t('pages.monitoring.rejected')}
                      value={compactNumber(asNumber(stats?.rejected))}
                      icon={<StopOutlined />}
                      tone={anyRejected ? 'warn' : undefined}
                    />
                    <Kpi
                      label={t('pages.inbounds.traffic')}
                      value={SizeFormatter.sizeFormat(
                        asNumber(inbound?.up) + asNumber(inbound?.down),
                      )}
                      hint={`${SizeFormatter.sizeFormat(asNumber(inbound?.up))} ↑ · ${SizeFormatter.sizeFormat(asNumber(inbound?.down))} ↓`}
                      icon={<SwapOutlined />}
                    />
                  </div>

                  <Card
                    size="small"
                    className="mon-activity-card"
                    title={t('pages.monitoring.activity')}
                  >
                    <ActivityChart
                      buckets={timeline}
                      emptyText={t('pages.monitoring.noLogs')}
                      eventsLabel={t('pages.monitoring.eventCount')}
                      rejectedLabel={t('pages.monitoring.rejected')}
                      height={isMobile ? 120 : 160}
                    />
                  </Card>

                  <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 12]}>
                    <Col xs={24} lg={14}>
                      <Card
                        size="small"
                        className="mon-insight-card"
                        title={t('pages.monitoring.topSites')}
                        extra={
                          <Typography.Text type="secondary">
                            {compactNumber(asNumber(stats?.uniqueDests))}
                          </Typography.Text>
                        }
                      >
                        <RankedList
                          items={siteItems}
                          emptyText={t('pages.monitoring.noLogs')}
                          onSelect={(item) => applyFilter(item.title || item.label)}
                        />
                      </Card>
                    </Col>
                    <Col xs={24} lg={10}>
                      <Card
                        size="small"
                        className="mon-insight-card"
                        title={t('pages.monitoring.topCountries')}
                      >
                        <RankedList items={countryItems} emptyText={t('pages.monitoring.noLogs')} />
                      </Card>
                    </Col>
                  </Row>

                  <Card
                    size="small"
                    className="mon-clients-card"
                    title={t('pages.monitoring.onlineClients')}
                    extra={`${asNumber(stats?.online)}/${clients.length}`}
                  >
                    <Table
                      size="small"
                      rowKey={(row) =>
                        asText(row.user) || asText(row.email) || asText(row.clientIp)
                      }
                      columns={clientColumns}
                      dataSource={clients}
                      pagination={{
                        current: clientPage,
                        pageSize: clientPageSize,
                        total: clients.length,
                        showSizeChanger: clients.length > 10,
                        pageSizeOptions: CLIENT_PAGE_SIZES.map(String),
                        hideOnSinglePage: clients.length <= clientPageSize,
                        onChange: (page, size) => {
                          setClientPage(page);
                          setClientPageSize(size);
                        },
                      }}
                      locale={{ emptyText: t('pages.monitoring.noOnlineClients') }}
                      scroll={{ x: true }}
                    />
                  </Card>

                  <Card
                    size="small"
                    className="mon-log-card"
                    title={
                      <Space size={8}>
                        {t('pages.monitoring.requests')}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {logCount.toLocaleString()} / {eventCount.toLocaleString()}
                        </Typography.Text>
                      </Space>
                    }
                  >
                    <Table
                      size="small"
                      rowKey={(row) =>
                        [asText(row.time), asText(row.email), asText(row.raw)].join('|')
                      }
                      columns={logColumns}
                      dataSource={[...logs].reverse()}
                      expandable={{ expandedRowRender: expandedLog }}
                      pagination={{
                        current: logPage,
                        pageSize: logPageSize,
                        total: logs.length,
                        showSizeChanger: true,
                        pageSizeOptions: LOG_PAGE_SIZES.map(String),
                        hideOnSinglePage: logs.length <= 20 && logPageSize <= 20,
                        onChange: (page, size) => {
                          setLogPage(page);
                          setLogPageSize(size);
                        },
                      }}
                      locale={{ emptyText: t('pages.monitoring.noLogs') }}
                      scroll={{ x: 1000 }}
                    />
                  </Card>
                </>
              )}
            </div>
          </Layout.Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
