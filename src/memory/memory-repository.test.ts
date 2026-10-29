import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { escapeLike, type DrizzleMemoryRepository } from './memory-repository.js';
import { createTestRepo } from './test-support.js';

const USER = '00000000-0000-0000-0000-000000000001';

let repo: DrizzleMemoryRepository;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ repo, close } = await createTestRepo());
});
afterAll(async () => close?.());

describe('DrizzleMemoryRepository', () => {
  it('creates the user on first load and returns empty memory', async () => {
    const memory = await repo.loadMemory(USER);
    expect(memory.user.id).toBe(USER);
    expect(memory.deceased).toEqual([]);
    expect(memory.recentSummaries).toEqual([]);
  });

  it('upserts a deceased person and merges later updates without erasing fields', async () => {
    await repo.upsertDeceased(USER, { name: 'דוד', relationship: 'אב', dateOfDeath: '2025-03-01' });
    await repo.upsertDeceased(USER, { name: ' דוד ', notes: 'אהב לשחק שחמט' });
    await repo.upsertDeceased(USER, { name: 'דוד', notes: 'היה נהג מונית' });

    const { deceased } = await repo.loadMemory(USER);
    expect(deceased).toHaveLength(1);
    expect(deceased[0]).toMatchObject({ name: 'דוד', relationship: 'אב', dateOfDeath: '2025-03-01' });
    expect(deceased[0]?.notes).toBe('אהב לשחק שחמט\nהיה נהג מונית');
  });

  it('updates user fields and appends notes', async () => {
    await repo.updateUser(USER, { firstName: 'נועה', gender: 'female', notes: 'מעדיפה שקט' });
    await repo.updateUser(USER, { notes: 'לא לדבר על הלוויה' });

    const { user } = await repo.loadMemory(USER);
    expect(user).toMatchObject({ firstName: 'נועה', gender: 'female' });
    expect(user.notes).toBe('מעדיפה שקט\nלא לדבר על הלוויה');
  });

  it('returns the 3 most recent call summaries, newest first', async () => {
    for (let i = 1; i <= 4; i++) {
      await repo.saveCallSummary(USER, {
        startedAt: new Date(2025, 0, i),
        endedAt: new Date(2025, 0, i, 0, 10),
        summary: `שיחה ${i}`,
        openThreads: i === 4 ? ['הלוויה'] : [],
      });
    }
    const { recentSummaries } = await repo.loadMemory(USER);
    expect(recentSummaries.map((s) => s.summary)).toEqual(['שיחה 4', 'שיחה 3', 'שיחה 2']);
    expect(recentSummaries[0]?.openThreads).toEqual(['הלוויה']);
  });

  it('clears all memory for a user', async () => {
    await repo.updateUser(USER, { firstName: 'נועה' });
    await repo.upsertDeceased(USER, { name: 'דוד' });
    await repo.saveCallSummary(USER, {
      startedAt: new Date(),
      endedAt: new Date(),
      summary: 'שיחה',
      openThreads: [],
    });

    await repo.clearMemory(USER);

    const memory = await repo.loadMemory(USER);
    expect(memory.user.firstName).toBeNull();
    expect(memory.deceased).toEqual([]);
    expect(memory.recentSummaries).toEqual([]);
  });

  it('stores companion preferences once per category+note and clears them with the user', async () => {
    await repo.addCompanionNote(USER, { category: 'likes', note: 'מוזיקה ים תיכונית' });
    await repo.addCompanionNote(USER, { category: 'likes', note: ' מוזיקה ים תיכונית ' });
    await repo.addCompanionNote(USER, { category: 'avoid', note: 'לא לדבר על עבודה' });

    const { companion } = await repo.loadMemory(USER);
    expect(companion.map((c) => `${c.category}:${c.note}`)).toEqual([
      'likes:מוזיקה ים תיכונית',
      'avoid:לא לדבר על עבודה',
    ]);

    await repo.clearMemory(USER);
    expect((await repo.loadMemory(USER)).companion).toEqual([]);
  });

  it('findOrCreateUserByPhoneHash returns the same user for the same hash', async () => {
    const first = await repo.findOrCreateUserByPhoneHash('a'.repeat(64));
    const second = await repo.findOrCreateUserByPhoneHash('a'.repeat(64));
    const other = await repo.findOrCreateUserByPhoneHash('b'.repeat(64));
    expect(second).toBe(first);
    expect(other).not.toBe(first);
  });

  it('findOrCreateUserByPhoneHash creates exactly one user under concurrent calls', async () => {
    const ids = await Promise.all(
      Array.from({ length: 10 }, () => repo.findOrCreateUserByPhoneHash('c'.repeat(64))),
    );
    expect(new Set(ids).size).toBe(1);
  });

  it('keeps each caller memory separate', async () => {
    const a = await repo.findOrCreateUserByPhoneHash('d'.repeat(64));
    const b = await repo.findOrCreateUserByPhoneHash('e'.repeat(64));
    await repo.upsertDeceased(a, { name: 'דוד' });
    expect((await repo.loadMemory(a)).deceased).toHaveLength(1);
    expect((await repo.loadMemory(b)).deceased).toHaveLength(0);
  });

  it('stores last4 on create and fills it for an existing user that lacks it', async () => {
    const id = await repo.findOrCreateUserByPhoneHash('f'.repeat(64));
    expect((await repo.loadMemory(id)).user.phoneLast4).toBeNull();
    await repo.findOrCreateUserByPhoneHash('f'.repeat(64), '4567');
    expect((await repo.loadMemory(id)).user.phoneLast4).toBe('4567');
    await repo.findOrCreateUserByPhoneHash('f'.repeat(64), '9999');
    expect((await repo.loadMemory(id)).user.phoneLast4).toBe('4567');
  });

  it('listUsers searches by first name, last 4 digits and deceased name, newest call first', async () => {
    const a = await repo.findOrCreateUserByPhoneHash('1'.repeat(64), '1111');
    const b = await repo.findOrCreateUserByPhoneHash('2'.repeat(64), '2222');
    await repo.updateUser(a, { firstName: 'דניאל' });
    await repo.upsertDeceased(b, { name: 'יצחק' });
    expect((await repo.listUsers()).map((u) => u.id).sort()).toEqual([a, b].sort());
    expect((await repo.listUsers({ q: 'דני' })).map((u) => u.id)).toEqual([a]);
    expect((await repo.listUsers({ q: '2222' })).map((u) => u.id)).toEqual([b]);
    expect((await repo.listUsers({ q: 'יצח' })).map((u) => u.id)).toEqual([b]);
  });

  it('listUsers finds a caller by a full number or by partial digits', async () => {
    const a = await repo.findOrCreateUserByPhoneHash('7'.repeat(64), '9405');
    await repo.findOrCreateUserByPhoneHash('8'.repeat(64), '1111');
    expect((await repo.listUsers({ q: '+972501239405' })).map((u) => u.id)).toEqual([a]);
    expect((await repo.listUsers({ q: '050-123-9405' })).map((u) => u.id)).toEqual([a]);
    expect((await repo.listUsers({ q: '940' })).map((u) => u.id)).toEqual([a]);
    expect((await repo.listUsers({ q: '05' })).map((u) => u.id)).toEqual([a]);
    expect(await repo.listUsers({ q: '777' })).toEqual([]);
  });

  it('listUsers treats % and _ in the search as plain characters', async () => {
    const a = await repo.findOrCreateUserByPhoneHash('3'.repeat(64), '3333');
    await repo.updateUser(a, { firstName: 'דניאל' });
    expect(await repo.listUsers({ q: '%' })).toEqual([]);
    expect(await repo.listUsers({ q: '_' })).toEqual([]);
  });

  it('listUsers reports call and deceased counts', async () => {
    const a = await repo.findOrCreateUserByPhoneHash('4'.repeat(64), '4444');
    await repo.upsertDeceased(a, { name: 'דוד' });
    await repo.saveCallSummary(a, { startedAt: new Date(), endedAt: new Date(), summary: 's', openThreads: [] });
    const [row] = await repo.listUsers({ q: '4444' });
    expect(row).toMatchObject({ callCount: 1, deceasedCount: 1 });
    expect(row?.lastCallAt).toBeInstanceOf(Date);
  });

  it('findMemory returns null for an unknown user and does not create it', async () => {
    const unknown = '99999999-9999-4999-8999-999999999999';
    expect(await repo.findMemory(unknown)).toBeNull();
    expect(await repo.findMemory(unknown)).toBeNull();
    expect((await repo.listUsers()).some((u) => u.id === unknown)).toBe(false);
  });

  it('findMemory returns all call summaries, newest first', async () => {
    const a = await repo.findOrCreateUserByPhoneHash('5'.repeat(64), '5555');
    for (let i = 0; i < 5; i++) {
      await repo.saveCallSummary(a, { startedAt: new Date(2026, 0, i + 1), endedAt: new Date(2026, 0, i + 1), summary: `s${i}`, openThreads: [] });
    }
    const memory = await repo.findMemory(a);
    expect(memory?.recentSummaries).toHaveLength(5);
    expect(memory?.recentSummaries[0]?.summary).toBe('s4');
  });

  it('deleteUser removes the user with their data and reports whether it existed', async () => {
    const a = await repo.findOrCreateUserByPhoneHash('6'.repeat(64), '6666');
    await repo.upsertDeceased(a, { name: 'דוד' });
    expect(await repo.deleteUser(a)).toBe(true);
    expect(await repo.findMemory(a)).toBeNull();
    expect(await repo.deleteUser(a)).toBe(false);
  });
});

describe('escapeLike', () => {
  it('escapes backslash, percent and underscore', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });
});
