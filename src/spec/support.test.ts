import { describe, expect, it } from 'vitest';

import { calls, headerOf } from './support.js';

describe('fetch support records headers from supported request forms', () => {
  it('reads Headers and Request headers without case sensitivity', () => {
    expect(headerOf({ url: 'https://example.test', init: { headers: new Headers({ Authorization: 'Bearer token' }) } }, 'authorization'))
      .toBe('Bearer token');
    expect(headerOf({ url: 'https://example.test', init: { headers: new Request('https://example.test', { headers: { Authorization: 'Bearer token' } }).headers } }, 'AUTHORIZATION'))
      .toBe('Bearer token');
  });
});
