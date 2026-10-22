import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { DrizzleMemoryRepository } from './memory-repository.js';
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
});
