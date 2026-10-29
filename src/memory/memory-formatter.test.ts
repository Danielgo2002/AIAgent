import { describe, expect, it } from 'vitest';
import { formatMemory } from './memory-formatter.js';
import type { UserMemory } from './types.js';

const base = (): UserMemory => ({
  user: {
    id: 'u1',
    firstName: null,
    addressAs: null,
    gender: null,
    notes: null,
    phoneHash: null,
    phoneLast4: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  deceased: [],
  companion: [],
  recentSummaries: [],
});

describe('formatMemory', () => {
  it('returns an empty string when nothing is known', () => {
    expect(formatMemory(base())).toBe('');
  });

  it('includes profile, deceased and summaries', () => {
    const memory = base();
    memory.user.firstName = 'נועה';
    memory.user.gender = 'female';
    memory.user.notes = 'מעדיפה שקט';
    memory.deceased.push({
      id: 'd1',
      userId: 'u1',
      name: 'דוד',
      relationship: 'אב',
      dateOfDeath: '2025-03-01',
      circumstances: null,
      notes: 'אהב שחמט',
      createdAt: new Date(),
    });
    memory.recentSummaries.push({
      id: 's1',
      userId: 'u1',
      startedAt: new Date('2025-04-02T10:00:00Z'),
      endedAt: new Date('2025-04-02T10:10:00Z'),
      summary: 'דיברנו על ההלוויה',
      mood: 'עצובה',
      openThreads: ['שיחה עם האחות'],
      createdAt: new Date(),
    });

    const text = formatMemory(memory);
    expect(text).toContain('נועה');
    expect(text).toContain('לשון נקבה');
    expect(text.split('לשון נקבה')).toHaveLength(2);
    expect(text).toContain('מעדיפה שקט');
    expect(text).toContain('דוד');
    expect(text).toContain('אב');
    expect(text).toContain('2025-03-01');
    expect(text).toContain('אהב שחמט');
    expect(text).toContain('דיברנו על ההלוויה');
    expect(text).toContain('שיחה עם האחות');
  });

  it('includes companion preferences', () => {
    const memory = base();
    memory.companion.push({
      id: 'c1',
      userId: 'u1',
      category: 'likes',
      note: 'מוזיקה ים תיכונית',
      createdAt: new Date(),
    });
    expect(formatMemory(memory)).toContain('מה אוהבים: מוזיקה ים תיכונית');
  });
});
