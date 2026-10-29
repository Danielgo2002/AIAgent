import { describe, expect, it } from 'vitest';
import { isValidAdminToken } from './auth.js';

const TOKEN = 'a'.repeat(32);

describe('isValidAdminToken', () => {
  it('accepts the exact bearer token', () => {
    expect(isValidAdminToken(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });
  it('rejects missing, wrong scheme, wrong token and different length', () => {
    expect(isValidAdminToken(undefined, TOKEN)).toBe(false);
    expect(isValidAdminToken(TOKEN, TOKEN)).toBe(false);
    expect(isValidAdminToken(`Bearer ${'b'.repeat(32)}`, TOKEN)).toBe(false);
    expect(isValidAdminToken('Bearer short', TOKEN)).toBe(false);
  });
});
