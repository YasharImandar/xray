import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('MonitoringPage', () => {
  it('renders extension inbound traffic logs with dest URL and packet', async () => {
    vi.mocked(HttpUtil.get).mockImplementation(async (url: string) => {
      if (url.includes('/panel/api/server/history/')) return new Msg(true, '', []);
      if (url.includes('/panel/api/server/extensionMonitor')) {
        return new Msg(true, '', {
          found: true,
          accessLogEnabled: true,
          inbound: {
            id: 1,
            remark: 'extension',
            tag: 'inbound-2053',
            protocol: 'vless',
            port: 2053,
            enable: true,
            up: 1024,
            down: 2048,
            clients: 1,
          },
          logs: [
            {
              time: '2025-01-01T12:00:00.000Z',
              email: 'alice@example.com',
              user: 'alice@example.com',
              clientIp: '192.0.2.10',
              country: 'United States',
              countryCode: 'US',
              clientPort: '54321',
              network: 'tcp',
              destHost: 'example.com',
              destPort: '443',
              destAddress: 'tcp:example.com:443',
              url: 'https://example.com',
              packet: 'tcp:example.com:443',
              inbound: 'inbound-2053',
              outbound: 'direct',
              status: 'accepted',
              event: 'direct',
              eventCode: 0,
              raw: '2025/01/01 12:00:00.000000 from 192.0.2.10:54321 accepted tcp:example.com:443 [inbound-2053 >> direct] email: alice@example.com',
            },
          ],
          clients: [
            {
              email: 'alice@example.com',
              user: 'alice@example.com',
              clientIp: '192.0.2.10',
              country: 'United States',
              countryCode: 'US',
              enable: true,
              online: true,
              up: 1024,
              down: 2048,
              lastDest: 'example.com:443',
              lastURL: 'https://example.com',
              recentDests: ['https://example.com'],
              hits: 1,
            },
          ],
          stats: {
            eventCount: 1,
            uniqueDests: 1,
            uniqueUsers: 1,
            online: 1,
            accepted: 1,
            rejected: 0,
          },
        });
      }
      return new Msg(false, 'unexpected get ' + url, null);
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
      expect(screen.getAllByText('alice@example.com').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('https://example.com').length).toBeGreaterThan(0);
    expect(screen.getAllByText('tcp:example.com:443').length).toBeGreaterThan(0);
    expect(screen.getByText('extension · 2053')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Clear log/ })).toBeTruthy();
    expect(screen.getAllByText(/United States/).length).toBeGreaterThan(0);
  });

  it('shows HTTP-proxy users by client IP when access log has no email', async () => {
    vi.mocked(HttpUtil.get).mockImplementation(async (url: string) => {
      if (url.includes('/panel/api/server/history/')) return new Msg(true, '', []);
      if (url.includes('/panel/api/server/extensionMonitor')) {
        return new Msg(true, '', {
          found: true,
          accessLogEnabled: true,
          inbound: {
            id: 1,
            remark: 'extension',
            tag: 'in-2053-tcp',
            protocol: 'http',
            port: 2053,
            enable: true,
            clients: 1,
          },
          logs: [
            {
              time: '2026-09-15T12:00:00.000Z',
              user: '192.0.2.10',
              clientIp: '192.0.2.10',
              country: 'Iran',
              countryCode: 'IR',
              destHost: 'youtube.com',
              destPort: '443',
              url: 'https://youtube.com',
              packet: 'youtube.com:443',
              inbound: 'in-2053-tcp',
              status: 'accepted',
              event: 'direct',
              raw: 'from 192.0.2.10:1 accepted //youtube.com:443 [in-2053-tcp >> direct]',
            },
          ],
          clients: [
            {
              user: '192.0.2.10',
              email: '192.0.2.10',
              clientIp: '192.0.2.10',
              country: 'Iran',
              countryCode: 'IR',
              online: true,
              lastURL: 'https://youtube.com',
              recentDests: ['https://youtube.com'],
              hits: 4,
            },
          ],
          stats: { eventCount: 1, uniqueDests: 1, uniqueUsers: 1, online: 1 },
        });
      }
      return new Msg(false, 'unexpected get ' + url, null);
    });

    renderWithProviders(
      <MemoryRouter>
        <MonitoringPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('192.0.2.10').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('https://youtube.com').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Iran/).length).toBeGreaterThan(0);
  });

  it('keeps a larger log page size after the monitor poll refreshes', async () => {
    const logs = Array.from({ length: 25 }, (_, i) => ({
      time: `2025-01-01T12:00:${String(i).padStart(2, '0')}.000Z`,
      user: 'alice@example.com',
      email: 'alice@example.com',
      clientIp: '192.0.2.10',
      url: `https://example.com/${i}`,
      packet: `pkt-${i}`,
      status: 'accepted',
      event: 'direct',
      raw: `raw-line-${i}`,
    }));
    vi.mocked(HttpUtil.get).mockImplementation(async (url: string) => {
      if (url.includes('/panel/api/server/history/')) return new Msg(true, '', []);
      if (url.includes('/panel/api/server/extensionMonitor')) {
        return new Msg(true, '', {
          found: true,
          accessLogEnabled: true,
          inbound: { id: 1, remark: 'extension', tag: 'inbound-2053', port: 2053, enable: true },
          logs,
          clients: [],
          stats: { eventCount: 25, uniqueDests: 25, uniqueUsers: 1, online: 0 },
        });
      }
      return new Msg(false, 'unexpected get ' + url, null);
    });

    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter>
        <MonitoringPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('https://example.com/24')).toBeTruthy();
    });
    const logCard = document.querySelector('.mon-log-card');
    expect(logCard).toBeTruthy();
    expect(within(logCard as HTMLElement).getAllByRole('row').length).toBeLessThan(25 + 2);

    const sizeTrigger = within(logCard as HTMLElement).getByRole('combobox');
    await user.click(sizeTrigger);
    await user.click(await screen.findByTitle('50 / page'));

    await waitFor(() => {
      expect(within(logCard as HTMLElement).getByText('https://example.com/0')).toBeTruthy();
      expect(within(logCard as HTMLElement).getByText('https://example.com/24')).toBeTruthy();
    });
  });
});
