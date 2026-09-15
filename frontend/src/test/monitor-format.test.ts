import { describe, expect, it } from 'vitest';

import { compactNumber, countryFlag, formatAgo, shortHost } from '@/pages/monitoring/format';

describe('countryFlag', () => {
  it('builds a regional-indicator flag from an ISO code', () => {
    expect(countryFlag('ir')).toBe('🇮🇷');
    expect(countryFlag('US')).toBe('🇺🇸');
  });

  it('ignores junk', () => {
    expect(countryFlag('')).toBe('');
    expect(countryFlag('cloudflare')).toBe('');
  });
});

describe('compactNumber', () => {
  it('keeps small counts exact and compacts large ones', () => {
    expect(compactNumber(319)).toBe('319');
    expect(compactNumber(9999)).toBe('9,999');
    expect(compactNumber(107711)).toBe('107.7K');
  });
});

describe('shortHost', () => {
  it('drops the scheme so a column of URLs stays readable', () => {
    expect(shortHost('https://www.youtube.com')).toBe('www.youtube.com');
    expect(shortHost('//example.com:443')).toBe('example.com:443');
    expect(shortHost('example.com')).toBe('example.com');
  });
});

describe('formatAgo', () => {
  const now = Date.UTC(2026, 8, 15, 12, 0, 0);

  it('scales the unit to the gap', () => {
    expect(formatAgo(now - 5_000, '-', now)).toBe('5s');
    expect(formatAgo(now - 120_000, '-', now)).toBe('2m');
    expect(formatAgo(now - 7_200_000, '-', now)).toBe('2h');
    expect(formatAgo(now - 172_800_000, '-', now)).toBe('2d');
  });

  it('accepts second-precision epochs and falls back when unset', () => {
    expect(formatAgo(Math.floor((now - 60_000) / 1000), '-', now)).toBe('1m');
    expect(formatAgo(0, 'none', now)).toBe('none');
    expect(formatAgo(undefined, 'none', now)).toBe('none');
  });
});
