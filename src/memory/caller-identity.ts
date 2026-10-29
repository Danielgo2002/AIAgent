import { DEMO_USER_ID } from '../config/demo-user.js';
import { createLogger } from '../logger.js';
import { hashPhone, normalizePhone } from './phone.js';
import type { MemoryRepository } from './types.js';

const log = createLogger('caller-identity');

/** Participant attribute LiveKit sets on SIP participants with the caller's number. */
export const SIP_PHONE_ATTRIBUTE = 'sip.phoneNumber';

export interface CallerParticipant {
  isSip: boolean;
  attributes: Record<string, string>;
}

/**
 * Maps the participant to a user id: the demo user for web, a per-number user for SIP callers,
 * and null (anonymous, nothing saved) when the number is hidden or the lookup fails.
 */
export async function resolveUserId(
  participant: CallerParticipant,
  repo: Pick<MemoryRepository, 'findOrCreateUserByPhoneHash'>,
  hashKey: string,
): Promise<string | null> {
  if (!participant.isSip) return DEMO_USER_ID;

  const phone = normalizePhone(participant.attributes[SIP_PHONE_ATTRIBUTE]);
  if (!phone) return null;

  try {
    return await repo.findOrCreateUserByPhoneHash(hashPhone(phone, hashKey));
  } catch (err) {
    log.error({ err }, 'failed to resolve caller, continuing anonymously');
    return null;
  }
}
