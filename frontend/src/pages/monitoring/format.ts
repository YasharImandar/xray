export function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) < 10_000) return value.toLocaleString();
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

export function countryFlag(code?: string): string {
  const cc = (code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 - 65 + ch.charCodeAt(0)));
}

/** Strips the scheme so a long list of URLs stays readable at a glance. */
export function shortHost(value: string): string {
  return value.replace(/^https?:\/\//, '').replace(/^\/\//, '');
}

export function formatWhen(value: string | undefined, empty: string): string {
  if (!value) return empty;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export function formatClock(ms: number | undefined): string {
  if (!ms || ms <= 0) return '';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Epoch values reach this page in both seconds and milliseconds. */
export function formatLastSeen(ts: number | undefined, empty: string): string {
  if (!ts || ts <= 0) return empty;
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toLocaleString();
}

export function formatAgo(ts: number | undefined, empty: string, now = Date.now()): string {
  if (!ts || ts <= 0) return empty;
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const secs = Math.max(0, Math.round((now - ms) / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86_400)}d`;
}
