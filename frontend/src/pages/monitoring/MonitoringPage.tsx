import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  Col,
  ConfigProvider,
  Layout,
  Result,
  Row,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudServerOutlined,
  ClusterOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  HddOutlined,
  SwapOutlined,
  TeamOutlined,
} from '@ant-design/icons';

import { CPUFormatter, HttpUtil, SizeFormatter } from '@/utils';
import { parseMsg } from '@/utils/zodValidate';
import {
  USAGE_CRIT_COLOR,
  USAGE_CRIT_PERCENT,
  USAGE_WARN_COLOR,
  USAGE_WARN_PERCENT,
} from '@/models/status';
import { useTheme } from '@/hooks/useTheme';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useStatusQuery } from '@/api/queries/useStatusQuery';
import { useNodesQuery } from '@/api/queries/useNodesQuery';
import { keys } from '@/api/queryKeys';
import { LastOnlineMapSchema, SlimInboundListSchema } from '@/schemas/inbound';
import { OnlinesSchema } from '@/schemas/client';
import { NodeListSchema } from '@/schemas/node';
import AppSidebar from '@/layouts/AppSidebar';
import VitalTile from '@/pages/index/VitalTile';
import ThroughputCard from '@/pages/index/ThroughputCard';
import ConnectionsCard from '@/pages/index/ConnectionsCard';
import SystemStrip from '@/pages/index/SystemStrip';
import { mean, peak, useOverviewHistory } from '@/pages/index/useOverviewHistory';
import '@/pages/index/IndexPage.css';
import './MonitoringPage.css';

const POLL_MS = 5000;

const XRAY_STATE_KEYS: Record<string, string> = {
  running: 'pages.index.xrayStatusRunning',
  stop: 'pages.index.xrayStatusStop',
  error: 'pages.index.xrayStatusError',
};

interface InboundRow {
  id: number;
  remark: string;
  protocol: string;
  port: number;
  enable: boolean;
  up: number;
  down: number;
  clients: number;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function formatLastSeen(ts: number | undefined, empty: string): string {
  if (!ts || ts <= 0) return empty;
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toLocaleString();
}

async function fetchOnlines(): Promise<string[]> {
  const msg = await HttpUtil.post('/panel/api/clients/onlines', undefined, { silent: true });
  if (!msg?.success) throw new Error(msg?.msg || 'Failed to fetch onlines');
  const validated = parseMsg(msg, OnlinesSchema, 'clients/onlines');
  return Array.isArray(validated.obj) ? validated.obj : [];
}

async function fetchLastOnline(): Promise<Record<string, number>> {
  const msg = await HttpUtil.post('/panel/api/clients/lastOnline', undefined, { silent: true });
  if (!msg?.success) throw new Error(msg?.msg || 'Failed to fetch lastOnline');
  const validated = parseMsg(msg, LastOnlineMapSchema, 'clients/lastOnline');
  return validated.obj && typeof validated.obj === 'object' ? validated.obj : {};
}

async function fetchSlimInbounds(): Promise<InboundRow[]> {
  const msg = await HttpUtil.get('/panel/api/inbounds/list/slim', undefined, { silent: true });
  if (!msg?.success) throw new Error(msg?.msg || 'Failed to fetch inbounds');
  const validated = parseMsg(msg, SlimInboundListSchema, 'inbounds/list/slim');
  const raw = Array.isArray(validated.obj) ? validated.obj : [];
  return raw.map((item) => {
    const row = item as Record<string, unknown>;
    const stats = Array.isArray(row.clientStats) ? row.clientStats : [];
    return {
      id: asNumber(row.id),
      remark: asString(row.remark) || asString(row.tag) || `#${asNumber(row.id)}`,
      protocol: asString(row.protocol),
      port: asNumber(row.port),
      enable: row.enable !== false,
      up: asNumber(row.up),
      down: asNumber(row.down),
      clients: stats.length,
    };
  });
}

export default function MonitoringPage() {
  const { t } = useTranslation();
  const { isDark, isUltra, antdThemeConfig } = useTheme();
  const { isMobile } = useMediaQuery();
  const { status, fetched, fetchError, refresh } = useStatusQuery();
  const history = useOverviewHistory(status, fetched && !fetchError);
  const { nodes, totals } = useNodesQuery();
  const [showIp, setShowIp] = useState(false);
  useQuery({
    queryKey: keys.nodes.list(),
    queryFn: async () => {
      const msg = await HttpUtil.get('/panel/api/nodes/list', undefined, { silent: true });
      if (!msg?.success) throw new Error(msg?.msg || 'Failed to fetch nodes');
      const validated = parseMsg(msg, NodeListSchema, 'nodes/list');
      return Array.isArray(validated.obj) ? validated.obj : [];
    },
    refetchInterval: POLL_MS,
  });

  const onlinesQuery = useQuery({
    queryKey: keys.clients.onlines(),
    queryFn: fetchOnlines,
    refetchInterval: POLL_MS,
  });
  const lastOnlineQuery = useQuery({
    queryKey: keys.clients.lastOnline(),
    queryFn: fetchLastOnline,
    refetchInterval: POLL_MS,
  });
  const inboundsQuery = useQuery({
    queryKey: keys.inbounds.slim(),
    queryFn: fetchSlimInbounds,
    refetchInterval: POLL_MS,
  });

  const onlines = onlinesQuery.data;
  const lastOnline = lastOnlineQuery.data;
  const inbounds = inboundsQuery.data;
  const enabledInbounds = (inbounds ?? []).filter((ib) => ib.enable).length;

  const pageClass =
    `monitoring-page index-page ${isDark ? 'is-dark' : ''} ${isUltra ? 'is-ultra' : ''}`.trim();
  const totalDisk = status.disk.total;
  const freeDisk = Math.max(0, totalDisk - status.disk.current);
  const xrayStateText = t(XRAY_STATE_KEYS[status.xray.state] ?? 'pages.index.xrayStatusUnknown');

  const health = useMemo(() => {
    const items = [
      { name: t('pages.index.cpu'), value: status.cpu.percent },
      { name: t('pages.index.memory'), value: status.mem.percent },
      { name: t('pages.index.swap'), value: status.swap.percent },
      { name: t('pages.index.storage'), value: status.disk.percent },
    ];
    const list = (xs: typeof items) => xs.map((i) => `${i.name} ${i.value.toFixed(0)}%`).join(', ');
    const crit = items.filter((i) => i.value >= USAGE_CRIT_PERCENT);
    if (crit.length) {
      return {
        text: t('pages.index.healthCritical', { list: list(crit) }),
        color: USAGE_CRIT_COLOR,
      };
    }
    const warm = items.filter((i) => i.value >= USAGE_WARN_PERCENT);
    if (warm.length) {
      return { text: t('pages.index.healthWarm', { list: list(warm) }), color: USAGE_WARN_COLOR };
    }
    return null;
  }, [status, t]);

  const onlineRows = (onlines ?? []).map((email) => ({
    key: email,
    email,
    lastSeen: lastOnline?.[email] ?? 0,
  }));

  const onlineColumns: ColumnsType<(typeof onlineRows)[number]> = [
    {
      title: t('pages.monitoring.onlineClients'),
      dataIndex: 'email',
      ellipsis: true,
      render: (email: string) => <Typography.Text copyable>{email}</Typography.Text>,
    },
    {
      title: t('lastOnline'),
      dataIndex: 'lastSeen',
      width: isMobile ? 140 : 200,
      render: (ts: number) => formatLastSeen(ts, t('none')),
    },
  ];

  const inboundColumns: ColumnsType<InboundRow> = [
    {
      title: t('remark'),
      dataIndex: 'remark',
      ellipsis: true,
    },
    {
      title: t('protocol'),
      dataIndex: 'protocol',
      width: 110,
      render: (protocol: string) => protocol.toUpperCase(),
    },
    {
      title: t('pages.inbounds.port'),
      dataIndex: 'port',
      width: 80,
    },
    {
      title: t('status'),
      dataIndex: 'enable',
      width: 100,
      render: (enable: boolean) => (
        <Tag color={enable ? 'green' : 'default'}>{enable ? t('enabled') : t('disabled')}</Tag>
      ),
    },
    {
      title: t('clients'),
      dataIndex: 'clients',
      width: 90,
    },
    {
      title: t('pages.inbounds.traffic'),
      key: 'traffic',
      render: (_, row) =>
        `${SizeFormatter.sizeFormat(row.up)} ↑ · ${SizeFormatter.sizeFormat(row.down)} ↓`,
    },
  ];

  const nodeColumns: ColumnsType<(typeof nodes)[number]> = [
    {
      title: t('pages.monitoring.nodeCount'),
      key: 'name',
      ellipsis: true,
      render: (_, node) => node.name || node.remark || node.address || `#${node.id}`,
    },
    {
      title: t('status'),
      dataIndex: 'status',
      width: 110,
      render: (value: string | undefined, node) => {
        if (!node.enable) return <Tag>{t('disabled')}</Tag>;
        const online = value === 'online';
        return <Tag color={online ? 'green' : 'red'}>{online ? t('online') : t('offline')}</Tag>;
      },
    },
    {
      title: t('pages.nodes.latency'),
      dataIndex: 'latencyMs',
      width: 100,
      render: (ms: number | undefined) => (ms && ms > 0 ? `${ms} ms` : t('none')),
    },
    {
      title: t('online'),
      dataIndex: 'onlineCount',
      width: 90,
      render: (count: number | undefined) => count ?? 0,
    },
  ];

  return (
    <ConfigProvider theme={antdThemeConfig}>
      <Layout className={pageClass}>
        <AppSidebar />
        <Layout className="content-shell">
          <Layout.Content id="content-layout" className="content-area">
            <Spin spinning={!fetched} delay={200} size="large">
              {!fetched ? (
                <div className="loading-spacer" />
              ) : fetchError ? (
                <Result
                  status="error"
                  title={t('somethingWentWrong')}
                  subTitle={fetchError}
                  extra={
                    <Button type="primary" onClick={refresh}>
                      {t('refresh')}
                    </Button>
                  }
                />
              ) : (
                <div className="ov-page">
                  <div className="mon-bar">
                    <Typography.Title level={4} className="mon-title">
                      {t('pages.monitoring.title')}
                    </Typography.Title>
                    <span className="mon-live">
                      <span className="mon-live-dot" />
                      {t('pages.monitoring.live')}
                    </span>
                    <span className="ov-state" data-state={status.xray.state}>
                      <span className="ov-state-dot" />
                      {xrayStateText}
                      {status.xray.version && status.xray.version !== 'Unknown'
                        ? ` · ${t('pages.monitoring.xrayVersion', { version: status.xray.version })}`
                        : ''}
                    </span>
                    {status.amneziawg.configured && (
                      <Tag color={status.amneziawg.running ? 'green' : 'orange'}>
                        {t('pages.monitoring.amneziawg')}
                      </Tag>
                    )}
                    <span className="mon-load">
                      {t('pages.monitoring.load')} {status.loads.join(' / ')}
                    </span>
                  </div>

                  {health && (
                    <div className="ov-health" style={{ color: health.color }}>
                      <span className="ov-health-mark" />
                      {health.text}
                    </div>
                  )}

                  <div className="ov-vitals">
                    <VitalTile
                      icon={<DashboardOutlined />}
                      label={t('pages.index.cpu')}
                      percent={status.cpu.percent}
                      statusColor={status.cpu.color}
                      detail={`${CPUFormatter.cpuCoreFormat(status.cpuCores)} / ${status.logicalPro}T · ${CPUFormatter.cpuSpeedFormat(status.cpuSpeedMhz)}`}
                      footLeft={`${t('pages.index.avg')} ${mean(history.series.cpu).toFixed(0)}%`}
                      footRight={`${t('pages.index.peak')} ${peak(history.series.cpu).toFixed(0)}%`}
                      data={history.series.cpu}
                      isMobile={isMobile}
                    />
                    <VitalTile
                      icon={<DatabaseOutlined />}
                      label={t('pages.index.memory')}
                      percent={status.mem.percent}
                      statusColor={status.mem.color}
                      detail={`${SizeFormatter.sizeFormat(status.mem.current)} / ${SizeFormatter.sizeFormat(status.mem.total)}`}
                      footLeft={`${t('pages.index.avg')} ${mean(history.series.mem).toFixed(0)}%`}
                      footRight={`${t('pages.index.peak')} ${peak(history.series.mem).toFixed(0)}%`}
                      data={history.series.mem}
                      isMobile={isMobile}
                    />
                    <VitalTile
                      icon={<SwapOutlined />}
                      label={t('pages.index.swap')}
                      percent={status.swap.percent}
                      statusColor={status.swap.color}
                      detail={`${SizeFormatter.sizeFormat(status.swap.current)} / ${SizeFormatter.sizeFormat(status.swap.total)}`}
                      footLeft={`${t('pages.index.avg')} ${mean(history.series.swap).toFixed(1)}%`}
                      footRight={`${t('pages.index.peak')} ${peak(history.series.swap).toFixed(0)}%`}
                      data={history.series.swap}
                      isMobile={isMobile}
                    />
                    <VitalTile
                      icon={<HddOutlined />}
                      label={t('pages.index.storage')}
                      percent={status.disk.percent}
                      statusColor={status.disk.color}
                      detail={`${SizeFormatter.sizeFormat(status.disk.current)} / ${SizeFormatter.sizeFormat(totalDisk)}`}
                      footLeft={`${t('pages.index.free')} ${SizeFormatter.sizeFormat(freeDisk)}`}
                      footRight={`${t('pages.index.avg')} ${mean(history.series.diskUsage).toFixed(1)}%`}
                      data={history.series.diskUsage}
                      isMobile={isMobile}
                    />
                  </div>

                  <div className="ov-mid">
                    <ThroughputCard
                      status={status}
                      up={history.series.netUp}
                      down={history.series.netDown}
                      labels={history.labels}
                      isMobile={isMobile}
                    />
                    <ConnectionsCard
                      status={status}
                      tcp={history.series.tcpCount}
                      udp={history.series.udpCount}
                      labels={history.labels}
                      isMobile={isMobile}
                    />
                  </div>

                  <SystemStrip
                    status={status}
                    showIp={showIp}
                    onToggleIp={() => setShowIp((v) => !v)}
                  />

                  <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 12]}>
                    <Col xs={8} sm={8} md={8}>
                      <Card size="small" hoverable className="summary-card">
                        <Statistic
                          title={t('pages.monitoring.onlineClients')}
                          value={onlines?.length ?? 0}
                          prefix={<TeamOutlined />}
                        />
                      </Card>
                    </Col>
                    <Col xs={8} sm={8} md={8}>
                      <Card size="small" hoverable className="summary-card">
                        <Statistic
                          title={t('pages.monitoring.inboundCount')}
                          value={`${enabledInbounds}/${inbounds?.length ?? 0}`}
                          prefix={<CloudServerOutlined />}
                        />
                      </Card>
                    </Col>
                    <Col xs={8} sm={8} md={8}>
                      <Card size="small" hoverable className="summary-card">
                        <Statistic
                          title={t('pages.monitoring.nodeCount')}
                          value={`${totals.online}/${totals.total}`}
                          prefix={
                            totals.offline > 0 ? (
                              <CloseCircleOutlined style={{ color: 'var(--ant-color-error)' }} />
                            ) : (
                              <CheckCircleOutlined style={{ color: 'var(--ant-color-success)' }} />
                            )
                          }
                        />
                      </Card>
                    </Col>
                  </Row>

                  <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 12]}>
                    <Col xs={24} lg={10}>
                      <Card
                        size="small"
                        title={t('pages.monitoring.onlineClients')}
                        extra={t('pages.monitoring.thisServer')}
                      >
                        <Table
                          size="small"
                          rowKey="key"
                          columns={onlineColumns}
                          dataSource={onlineRows}
                          pagination={onlineRows.length > 8 ? { pageSize: 8 } : false}
                          locale={{ emptyText: t('pages.monitoring.noOnlineClients') }}
                          scroll={{ x: true }}
                        />
                      </Card>
                    </Col>
                    <Col xs={24} lg={14}>
                      <Card size="small" title={t('pages.monitoring.inboundCount')}>
                        <Table
                          size="small"
                          rowKey="id"
                          columns={inboundColumns}
                          dataSource={inbounds ?? []}
                          pagination={(inbounds?.length ?? 0) > 8 ? { pageSize: 8 } : false}
                          locale={{ emptyText: t('pages.monitoring.noInbounds') }}
                          scroll={{ x: true }}
                        />
                      </Card>
                    </Col>
                  </Row>

                  {nodes.length > 0 && (
                    <Card
                      size="small"
                      title={t('pages.monitoring.nodeCount')}
                      extra={<ClusterOutlined />}
                    >
                      <Table
                        size="small"
                        rowKey="id"
                        columns={nodeColumns}
                        dataSource={nodes}
                        pagination={nodes.length > 8 ? { pageSize: 8 } : false}
                        locale={{ emptyText: t('pages.monitoring.noNodes') }}
                        scroll={{ x: true }}
                      />
                    </Card>
                  )}
                </div>
              )}
            </Spin>
          </Layout.Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
