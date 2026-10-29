import { describe, expect, it, vi } from 'vitest';
import { DEMO_USER_ID } from '../config/demo-user.js';
import { resolveUserId } from './caller-identity.js';
import { hashPhone } from './phone.js';

const KEY = 'k'.repeat(32);

describe('resolveUserId', () => {
  it('returns the demo user for a non-SIP participant', async () => {
    const repo = { findOrCreateUserByPhoneHash: vi.fn() };
    const id = await resolveUserId({ isSip: false, attributes: {} }, repo, KEY);
    expect(id).toBe(DEMO_USER_ID);
    expect(repo.findOrCreateUserByPhoneHash).not.toHaveBeenCalled();
  });

  it('looks up the SIP caller by hashed, normalized number', async () => {
    const repo = { findOrCreateUserByPhoneHash: vi.fn().mockResolvedValue('user-123') };
    const id = await resolveUserId({ isSip: true, attributes: { 'sip.phoneNumber': '+972 50-123-4567' } }, repo, KEY);
    expect(id).toBe('user-123');
    expect(repo.findOrCreateUserByPhoneHash).toHaveBeenCalledWith(hashPhone('+972501234567', KEY), '4567');
  });

  it('returns null (anonymous) for a SIP caller with no valid number', async () => {
    const repo = { findOrCreateUserByPhoneHash: vi.fn() };
    expect(await resolveUserId({ isSip: true, attributes: {} }, repo, KEY)).toBeNull();
    expect(await resolveUserId({ isSip: true, attributes: { 'sip.phoneNumber': 'anonymous' } }, repo, KEY)).toBeNull();
    expect(repo.findOrCreateUserByPhoneHash).not.toHaveBeenCalled();
  });

  it('returns null when the repository throws', async () => {
    const repo = { findOrCreateUserByPhoneHash: vi.fn().mockRejectedValue(new Error('db down')) };
    const id = await resolveUserId({ isSip: true, attributes: { 'sip.phoneNumber': '+972501234567' } }, repo, KEY);
    expect(id).toBeNull();
  });
});
