import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import MonitoringPage from '@/pages/monitoring/MonitoringPage';
import { HttpUtil, Msg } from '@/utils';
import { renderWithProviders } from './test-utils';

vi.mock('@/api/queries/useAllSettings', () => ({
  useAllSettings: () => ({ allSetting: {} }),
}));

vi.mock('@/components/viz', () => ({
  Sparkline: () => <div data-testid="sparkline" />,
}));

vi.mock('@/api/queries/useStatusQuery', async () => {
  const { Status: StatusModel } = await import('@/models/status');
  const status = new StatusModel({
    cpu: 12,
    cpuCores: 4,
    logicalPro: 8,
    cpuSpeedMhz: 2400,
    disk: { current: 10, total: 100 },
    loads: [0.1, 0.2, 0.3],
    mem: { current: 1024, total: 4096 },
    netIO: { up: 100, down: 200 },
    netTraffic: { sent: 1000, recv: 2000 },
    publicIP: { ipv4: '1.2.3.4', ipv6: '::1' },
    swap: { current: 0, total: 0 },
    tcpCount: 3,
    udpCount: 1,
    uptime: 3600,
    appUptime: 120,
    appStats: { threads: 10, mem: 50, uptime: 120 },
    xray: { state: 'running', errorMsg: '', version: '1.8.24', color: 'green' },
    amneziawg: { configured: false, running: false },
  });
  return {
    useStatusQuery: () => ({
      status,
      fetched: true,
      fetchError: '',
      refresh: vi.fn(),
    }),
  };
});

vi.mock('@/api/queries/useNodesQuery', () => ({
  useNodesQuery: () => ({
    nodes: [],
    totals: {
      total: 0,
      online: 0,
      offline: 0,
      avgLatency: 0,
      inbounds: 0,
      clients: 0,
      onlineClients: 0,
      depleted: 0,
    },
    loading: false,
    fetched: true,
    fetchError: '',
    refetch: vi.fn(),
  }),
}));

describe('MonitoringPage', () => {
  it('renders live monitoring with online clients and inbound traffic', async () => {
    vi.mocked(HttpUtil.get).mockImplementation(async (url: string) => {
      if (url.includes('/panel/api/server/history/')) return new Msg(true, '', []);
      if (url.includes('/panel/api/nodes/list')) return new Msg(true, '', []);
      if (url.includes('/panel/api/inbounds/list/slim')) {
        return new Msg(true, '', [
          {
            id: 1,
            remark: 'vless-443',
            tag: 'in-443',
            protocol: 'vless',
            port: 443,
            enable: true,
            up: 1024,
            down: 2048,
            clientStats: [{ email: 'alice@example.com' }],
          },
        ]);
      }
      return new Msg(false, 'unexpected get ' + url, null);
    });
    vi.mocked(HttpUtil.post).mockImplementation(async (url: string) => {
      if (url.includes('/panel/api/clients/onlines')) {
        return new Msg(true, '', ['alice@example.com']);
      }
      if (url.includes('/panel/api/clients/lastOnline')) {
        return new Msg(true, '', { 'alice@example.com': 1735680000000 });
      }
      return new Msg(false, 'unexpected post ' + url, null);
    });

    renderWithProviders(
      <MemoryRouter>
        <MonitoringPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Live')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeTruthy();
    });
    expect(screen.getByText('vless-443')).toBeTruthy();
    expect(screen.getByText('VLESS')).toBeTruthy();
  });
});
