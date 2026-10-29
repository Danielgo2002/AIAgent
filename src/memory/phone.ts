import { createHmac } from 'node:crypto';

const E164 = /^\+[1-9]\d{6,14}$/;

/** Returns the number in E.164 form, or null when it is missing or not a valid international number. */
export function normalizePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  let value = raw.replace(/[\s\-().]/g, '');
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  return E164.test(value) ? value : null;
}

/** Keyed hash used as the caller's identity; the raw number is never stored. */
export function hashPhone(e164: string, key: string): string {
  return createHmac('sha256', key).update(e164).digest('hex');
}
