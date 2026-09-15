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
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  GlobalOutlined,
  LinkOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';

import { HttpUtil, SizeFormatter } from '@/utils';
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
import { countryFlag } from './country';

const POLL_MS = 3000;
const LOG_COUNT = 400;
const LOG_PAGE_SIZES = [20, 50, 100, 200, 400];
const CLIENT_PAGE_SIZES = [8, 20, 50, 100];

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

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function formatWhen(value: string | undefined, empty: string): string {
  if (!value) return empty;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
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

function formatLastSeen(ts: number | undefined, empty: string): string {
  if (!ts || ts <= 0) return empty;
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toLocaleString();
}

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

export default function MonitoringPage() {
  const { t } = useTranslation();
  const { isDark, isUltra, antdThemeConfig } = useTheme();
  const { isMobile } = useMediaQuery();
  const { status } = useStatusQuery();
  const [filter, setFilter] = useState('');
  const [paused, setPaused] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [logPage, setLogPage] = useState(1);
  const [logPageSize, setLogPageSize] = useState(20);
  const [clientPage, setClientPage] = useState(1);
  const [clientPageSize, setClientPageSize] = useState(8);

  const monitorQuery = useQuery({
    queryKey: keys.server.extensionMonitor(LOG_COUNT, filter),
    queryFn: () => fetchExtensionMonitor(filter),
    refetchInterval: paused ? false : POLL_MS,
  });

  const snapshot = monitorQuery.data;
  const inbound = snapshot?.inbound;
  const logs = snapshot?.logs ?? [];
  const clients = snapshot?.clients ?? [];
  const stats = snapshot?.stats;
  const xrayStateText = t(XRAY_STATE_KEYS[status.xray.state] ?? 'pages.index.xrayStatusUnknown');
  const pageClass =
    `monitoring-page ${isDark ? 'is-dark' : ''} ${isUltra ? 'is-ultra' : ''}`.trim();

  const clientColumns: ColumnsType<ExtensionClientRow> = [
    {
      title: t('pages.monitoring.user'),
      key: 'user',
      ellipsis: true,
      render: (_, row) => (
        <Space size={6}>
          <Tag color={row.online ? 'green' : 'default'}>
            {row.online ? t('online') : t('offline')}
          </Tag>
          <Typography.Text copyable>
            {asText(row.user) || asText(row.email) || t('none')}
          </Typography.Text>
          <CountryBeside country={asText(row.country)} countryCode={asText(row.countryCode)} />
        </Space>
      ),
    },
    {
      title: t('pages.monitoring.clientIp'),
      dataIndex: 'clientIp',
      width: 220,
      render: (ip: string | undefined, row) => {
        const addr = asText(ip);
        if (!addr) return t('none');
        return (
          <Space size={6} wrap>
            <Typography.Text copyable={{ text: addr }}>{addr}</Typography.Text>
            <CountryBeside country={asText(row.country)} countryCode={asText(row.countryCode)} />
          </Space>
        );
      },
    },
    {
      title: t('pages.monitoring.lastDest'),
      key: 'lastDest',
      ellipsis: true,
      render: (_, row) => asText(row.lastURL) || asText(row.lastDest) || t('none'),
    },
    {
      title: t('pages.monitoring.recentDests'),
      key: 'recentDests',
      ellipsis: true,
      render: (_, row) => {
        const dests = Array.isArray(row.recentDests) ? row.recentDests.filter(Boolean) : [];
        if (dests.length === 0) return t('none');
        return dests.slice(0, 3).join(' · ');
      },
    },
    {
      title: t('pages.monitoring.hits'),
      dataIndex: 'hits',
      width: 80,
      render: (hits: number | undefined) => hits ?? 0,
    },
    {
      title: t('pages.inbounds.traffic'),
      key: 'traffic',
      render: (_, row) =>
        `${SizeFormatter.sizeFormat(asNumber(row.up))} ↑ · ${SizeFormatter.sizeFormat(asNumber(row.down))} ↓`,
    },
    {
      title: t('lastOnline'),
      dataIndex: 'lastOnline',
      width: isMobile ? 140 : 200,
      render: (ts: number | undefined) => formatLastSeen(ts, t('none')),
    },
  ];

  const logColumns: ColumnsType<ExtensionLogEntry> = [
    {
      title: t('pages.monitoring.details'),
      dataIndex: 'time',
      width: isMobile ? 110 : 170,
      render: (value: string | undefined) => formatWhen(value, t('none')),
    },
    {
      title: t('pages.monitoring.user'),
      dataIndex: 'email',
      ellipsis: true,
      render: (email: string | undefined, row) => {
        const user = asText(row.user) || asText(email);
        return user ? <Typography.Text copyable>{user}</Typography.Text> : t('none');
      },
    },
    {
      title: t('pages.monitoring.clientIp'),
      key: 'client',
      width: 150,
      render: (_, row) => {
        const ip = asText(row.clientIp);
        const port = asText(row.clientPort);
        if (!ip) return t('none');
        return (
          <Space size={6} wrap>
            <Typography.Text copyable={{ text: port ? `${ip}:${port}` : ip }}>
              {port ? `${ip}:${port}` : ip}
            </Typography.Text>
            <CountryBeside country={asText(row.country)} countryCode={asText(row.countryCode)} />
          </Space>
        );
      },
    },
    {
      title: t('pages.monitoring.destUrl'),
      dataIndex: 'url',
      ellipsis: true,
      render: (url: string | undefined, row) => (
        <Typography.Text copyable={{ text: url || asText(row.destAddress) }}>
          {url || asText(row.destAddress) || t('none')}
        </Typography.Text>
      ),
    },
    {
      title: t('pages.monitoring.packet'),
      dataIndex: 'packet',
      ellipsis: true,
      render: (packet: string | undefined) => packet || t('none'),
    },
    {
      title: t('pages.monitoring.network'),
      dataIndex: 'network',
      width: 80,
      render: (network: string | undefined) => (network ? network.toUpperCase() : t('none')),
    },
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
          {
            label: t('pages.monitoring.user'),
            children: asText(row.user) || asText(row.email) || t('none'),
          },
          { label: t('pages.monitoring.destUrl'), children: asText(row.url) || t('none') },
          { label: t('pages.monitoring.destHost'), children: asText(row.destHost) || t('none') },
          { label: t('pages.monitoring.destPort'), children: asText(row.destPort) || t('none') },
          { label: t('pages.monitoring.packet'), children: asText(row.packet) || t('none') },
          { label: t('pages.monitoring.network'), children: asText(row.network) || t('none') },
          {
            label: t('pages.monitoring.clientIp'),
            children: asText(row.clientIp) || t('none'),
          },
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
              <Space orientation="vertical" style={{ width: '100%' }}>
                <Typography.Paragraph copyable className="mon-raw">
                  {asText(row.raw)}
                </Typography.Paragraph>
              </Space>
            ),
          },
        ]}
      />
    ),
    [isMobile, t],
  );

  return (
    <ConfigProvider theme={antdThemeConfig}>
      <Layout className={pageClass}>
        <AppSidebar />
        <Layout className="content-shell">
          <Layout.Content id="content-layout" className="content-area">
            <div className="mon-page">
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
                  <Typography.Paragraph className="mon-hint">
                    {t('pages.monitoring.sniffHint')}
                  </Typography.Paragraph>

                  {snapshot && snapshot.accessLogEnabled === false && (
                    <Alert
                      type="warning"
                      showIcon
                      className="mon-alert"
                      message={t('pages.monitoring.accessLogOff')}
                    />
                  )}

                  <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 12]}>
                    <Col xs={12} md={6}>
                      <Card size="small" className="summary-card">
                        <Statistic
                          title={t('pages.monitoring.eventCount')}
                          value={stats?.eventCount ?? 0}
                          prefix={<ThunderboltOutlined />}
                        />
                      </Card>
                    </Col>
                    <Col xs={12} md={6}>
                      <Card size="small" className="summary-card">
                        <Statistic
                          title={t('pages.monitoring.uniqueDests')}
                          value={stats?.uniqueDests ?? 0}
                          prefix={<GlobalOutlined />}
                        />
                      </Card>
                    </Col>
                    <Col xs={12} md={6}>
                      <Card size="small" className="summary-card">
                        <Statistic
                          title={t('pages.monitoring.uniqueIps')}
                          value={stats?.uniqueIps ?? 0}
                          prefix={<TeamOutlined />}
                        />
                      </Card>
                    </Col>
                    <Col xs={12} md={6}>
                      <Card size="small" className="summary-card">
                        <Statistic
                          title={t('pages.monitoring.onlineClients')}
                          value={stats?.online ?? 0}
                          prefix={<LinkOutlined />}
                        />
                      </Card>
                    </Col>
                  </Row>

                  {inbound && (
                    <Card size="small" className="mon-inbound-card">
                      <Descriptions
                        size="small"
                        column={isMobile ? 1 : 4}
                        items={[
                          {
                            label: t('remark'),
                            children: inbound.remark || t('pages.monitoring.extensionInbound'),
                          },
                          { label: t('pages.inbounds.port'), children: inbound.port },
                          {
                            label: t('protocol'),
                            children: (inbound.protocol || '').toUpperCase() || t('none'),
                          },
                          {
                            label: t('pages.monitoring.inboundTag'),
                            children: inbound.tag || t('none'),
                          },
                          {
                            label: t('pages.inbounds.traffic'),
                            children: `${SizeFormatter.sizeFormat(asNumber(inbound.up))} ↑ · ${SizeFormatter.sizeFormat(asNumber(inbound.down))} ↓`,
                          },
                          {
                            label: t('pages.monitoring.accepted'),
                            children: stats?.accepted ?? 0,
                          },
                          {
                            label: t('pages.monitoring.rejected'),
                            children: stats?.rejected ?? 0,
                          },
                          {
                            label: t('pages.monitoring.uniqueIps'),
                            children: inbound.clients ?? clients.length,
                          },
                        ]}
                      />
                    </Card>
                  )}

                  <Card
                    size="small"
                    title={t('pages.monitoring.onlineClients')}
                    extra={`${stats?.online ?? 0}/${clients.length}`}
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
                        showSizeChanger: clients.length > 8,
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
                        {t('pages.monitoring.packet')}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {(stats?.logCount ?? logs.length).toLocaleString()} /{' '}
                          {(stats?.eventCount ?? logs.length).toLocaleString()}
                        </Typography.Text>
                      </Space>
                    }
                    extra={
                      <Input.Search
                        allowClear
                        placeholder={t('pages.monitoring.filterLogs')}
                        onSearch={(value) => {
                          setFilter(value);
                          setLogPage(1);
                        }}
                        style={{ width: isMobile ? 180 : 280 }}
                      />
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
                      scroll={{ x: 1100 }}
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
