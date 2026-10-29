import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Constant-time check of an `Authorization: Bearer <token>` header. */
export function isValidAdminToken(header: string | undefined, expected: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  if (!match?.[1]) return false;
  return timingSafeEqual(digest(match[1]), digest(expected));
}
