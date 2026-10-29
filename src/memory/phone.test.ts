import { describe, expect, it } from 'vitest';
import { hashPhone, normalizePhone } from './phone.js';

const KEY = 'k'.repeat(32);

describe('normalizePhone', () => {
  it('keeps a valid E.164 number', () => {
    expect(normalizePhone('+972501234567')).toBe('+972501234567');
  });

  it('strips spaces, dashes, dots and parentheses', () => {
    expect(normalizePhone('+972 (50) 123-4567')).toBe('+972501234567');
    expect(normalizePhone('+972.50.123.4567')).toBe('+972501234567');
  });

  it('converts a leading 00 to +', () => {
    expect(normalizePhone('00972501234567')).toBe('+972501234567');
  });

  it('returns null for missing, empty, local-format or malformed input', () => {
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('0501234567')).toBeNull();
    expect(normalizePhone('+12')).toBeNull();
    expect(normalizePhone('+97250abc4567')).toBeNull();
    expect(normalizePhone('+9725012345678901')).toBeNull();
    expect(normalizePhone('anonymous')).toBeNull();
  });
});

describe('hashPhone', () => {
  it('is stable for the same number and key', () => {
    expect(hashPhone('+972501234567', KEY)).toBe(hashPhone('+972501234567', KEY));
  });

  it('differs for different numbers and different keys', () => {
    expect(hashPhone('+972501234567', KEY)).not.toBe(hashPhone('+972501234568', KEY));
    expect(hashPhone('+972501234567', KEY)).not.toBe(hashPhone('+972501234567', 'z'.repeat(32)));
  });

  it('returns 64 hex chars that contain no part of the number', () => {
    const hash = hashPhone('+972501234567', KEY);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('972501234567');
  });
});
