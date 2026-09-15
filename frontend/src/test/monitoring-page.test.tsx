import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import MonitoringPage from '@/pages/monitoring/MonitoringPage';
import { ClipboardManager, HttpUtil, Msg } from '@/utils';
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

const INBOUND = {
  id: 1,
  remark: 'extension',
  tag: 'in-2053-tcp',
  protocol: 'http',
  port: 2053,
  enable: true,
  up: 1024,
  down: 2048,
};

/** Mocks the snapshot endpoint, returning the query strings it was called with. */
function mockMonitor(payload: Record<string, unknown>): string[] {
  const urls: string[] = [];
  vi.mocked(HttpUtil.get).mockImplementation(async (url: string, params?: unknown) => {
    if (url.includes('/panel/api/server/history/')) return new Msg(true, '', []);
    if (url.includes('/panel/api/server/extensionMonitor')) {
      const filter = (params as { filter?: unknown } | undefined)?.filter;
      urls.push(String(filter ?? ''));
      return new Msg(true, '', payload);
    }
    return new Msg(false, 'unexpected get ' + url, null);
  });
  return urls;
}

describe('MonitoringPage', () => {
  it('renders account-based traffic with the user and client IP split apart', async () => {
    mockMonitor({
      found: true,
      accessLogEnabled: true,
      inbound: { ...INBOUND, protocol: 'vless' },
      logs: [
        {
          time: '2025-01-01T12:00:00.000Z',
          email: 'alice@example.com',
          user: 'alice@example.com',
          clientIp: '192.0.2.10',
          clientPort: '54321',
          network: 'tcp',
          destHost: 'example.com',
          destPort: '443',
          destAddress: 'tcp:example.com:443',
          url: 'https://example.com',
          packet: 'tcp:example.com:443',
          country: 'United States',
          countryCode: 'US',
          inbound: 'in-2053-tcp',
          outbound: 'direct',
          status: 'accepted',
          event: 'direct',
          raw: 'from 192.0.2.10:54321 accepted tcp:example.com:443 [in-2053-tcp >> direct]',
        },
      ],
      clients: [
        {
          email: 'alice@example.com',
          user: 'alice@example.com',
          clientIp: '192.0.2.10',
          country: 'United States',
          countryCode: 'US',
          online: true,
          up: 1024,
          down: 2048,
          lastURL: 'https://example.com',
          recentDests: ['https://example.com'],
          hits: 1,
        },
      ],
      topDests: [
        { host: 'example.com', port: '443', url: 'https://example.com', hits: 1, clients: 1 },
      ],
      countries: [{ code: 'US', name: 'United States', clients: 1, hits: 1 }],
      timeline: [{ at: 1735732800000, events: 1, rejected: 0 }],
      stats: { eventCount: 1, uniqueDests: 1, uniqueIps: 1, online: 1, accepted: 1, logCount: 1 },
    });

    renderWithProviders(
      <MemoryRouter>
        <MonitoringPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Live')).toBeTruthy());
    await waitFor(() => expect(screen.getAllByText('alice@example.com').length).toBeGreaterThan(0));

    const clientCard = document.querySelector('.mon-clients-card');
    const headers = within(clientCard as HTMLElement)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers).toContain('User');
    expect(headers).toContain('Client IP');
    expect(screen.getAllByText(/United States/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Clear log/ })).toBeTruthy();
  });

  it('identifies HTTP-proxy users by IP and drops the duplicate user column', async () => {
    mockMonitor({
      found: true,
      accessLogEnabled: true,
      inbound: INBOUND,
      logs: [
        {
          time: '2026-09-15T12:00:00.000Z',
          user: '192.0.2.10',
          email: '',
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
          email: '',
          clientIp: '192.0.2.10',
          country: 'Iran',
          countryCode: 'IR',
          online: true,
          lastURL: 'https://youtube.com',
          recentDests: ['https://youtube.com'],
          hits: 4,
        },
      ],
      topDests: [
        { host: 'youtube.com', port: '443', url: 'https://youtube.com', hits: 4, clients: 1 },
      ],
      countries: [{ code: 'IR', name: 'Iran', clients: 1, hits: 4 }],
      timeline: [{ at: 1789473600000, events: 4, rejected: 0 }],
      stats: { eventCount: 4, uniqueDests: 1, uniqueIps: 1, online: 1, accepted: 4, logCount: 1 },
    });

    renderWithProviders(
      <MemoryRouter>
        <MonitoringPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getAllByText('192.0.2.10').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Iran/).length).toBeGreaterThan(0);

    // No accounts on an HTTP inbound, so the IP is the identity and must not
    // also get a redundant User column next to it.
    const clientCard = document.querySelector('.mon-clients-card');
    const headers = within(clientCard as HTMLElement)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers).toContain('Client IP');
    expect(headers).not.toContain('User');
    // Per-client byte counters stay zero on an HTTP inbound.
    expect(headers).not.toContain('Traffic');
  });

  it('ranks the busiest sites and filters the snapshot when one is clicked', async () => {
    const filters = mockMonitor({
      found: true,
      accessLogEnabled: true,
      inbound: INBOUND,
      logs: [],
      clients: [],
      topDests: [
        {
          host: 'www.youtube.com',
          port: '443',
          url: 'https://www.youtube.com',
          hits: 5794,
          clients: 37,
        },
        {
          host: 'ads.example',
          port: '443',
          url: 'https://ads.example',
          hits: 12,
          clients: 2,
          rejected: 12,
        },
      ],
      countries: [
        { code: 'IR', name: 'Iran', clients: 280, hits: 91234 },
        { code: 'US', name: 'United States', clients: 12, hits: 640 },
      ],
      timeline: [{ at: 1789473600000, events: 5794, rejected: 12 }],
      stats: { eventCount: 107711, uniqueDests: 108, uniqueIps: 319, online: 11, rejected: 12 },
    });

    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter>
        <MonitoringPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('www.youtube.com')).toBeTruthy());
    // KPI tiles report the whole log, compacted.
    expect(screen.getByText('107.7K')).toBeTruthy();
    expect(screen.getByText('319')).toBeTruthy();
    expect(screen.getByText(/🇮🇷 Iran/)).toBeTruthy();

    await user.click(screen.getByText('www.youtube.com'));

    await waitFor(() => expect(filters).toContain('www.youtube.com'));
    expect(screen.getByText(/Filtered: www\.youtube\.com/)).toBeTruthy();
  });

  it('keeps a larger request page size after the monitor poll refreshes', async () => {
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
    mockMonitor({
      found: true,
      accessLogEnabled: true,
      inbound: INBOUND,
      logs,
      clients: [],
      topDests: [],
      countries: [],
      timeline: [],
      stats: {
        eventCount: 107711,
        uniqueDests: 108,
        uniqueIps: 319,
        online: 11,
        logCount: 25,
      },
    });

    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter>
        <MonitoringPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('example.com/24')).toBeTruthy());
    const logCard = document.querySelector('.mon-log-card');
    expect(logCard).toBeTruthy();
    expect(within(logCard as HTMLElement).getAllByRole('row').length).toBeLessThan(25 + 2);
    expect(within(logCard as HTMLElement).getByText(/25 \/ 107,711/)).toBeTruthy();

    const sizeTrigger = within(logCard as HTMLElement).getByRole('combobox');
    await user.click(sizeTrigger);
    await user.click(await screen.findByTitle('50 / page'));

    await waitFor(() => {
      expect(within(logCard as HTMLElement).getByText('example.com/0')).toBeTruthy();
      expect(within(logCard as HTMLElement).getByText('example.com/24')).toBeTruthy();
    });
  });

  it('copies the loaded raw log lines, oldest first, to the clipboard', async () => {
    const copySpy = vi.spyOn(ClipboardManager, 'copyText').mockResolvedValue(true);
    mockMonitor({
      found: true,
      accessLogEnabled: true,
      inbound: INBOUND,
      logs: [
        {
          time: '2025-01-01T12:00:00.000Z',
          user: '192.0.2.10',
          email: '',
          clientIp: '192.0.2.10',
          url: 'https://a.example',
          packet: 'a.example:443',
          status: 'accepted',
          event: 'direct',
          raw: 'raw-line-1',
        },
        {
          time: '2025-01-01T12:00:01.000Z',
          user: '192.0.2.10',
          email: '',
          clientIp: '192.0.2.10',
          url: 'https://b.example',
          packet: 'b.example:443',
          status: 'accepted',
          event: 'direct',
          raw: 'raw-line-2',
        },
      ],
      clients: [],
      topDests: [],
      countries: [],
      timeline: [],
      stats: { eventCount: 2, uniqueDests: 2, uniqueIps: 1, online: 0, accepted: 2, logCount: 2 },
    });

    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter>
        <MonitoringPage />
      </MemoryRouter>,
    );

    const copyBtn = await screen.findByRole('button', { name: /Copy log/ });
    await user.click(copyBtn);

    await waitFor(() => expect(copySpy).toHaveBeenCalledWith('raw-line-1\nraw-line-2'));
    copySpy.mockRestore();
  });
});
