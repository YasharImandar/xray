import { describe, expect, it } from 'vitest';

import { countryFlag } from '@/pages/monitoring/country';

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
