import { describe, expect, it } from 'vitest';
import type { UserMemory } from '../memory/types.js';
import { buildTranscriptionPrompt, PHONE_INSTRUCTIONS } from './phone-profile.js';

const now = new Date();
const memory = (over: Partial<UserMemory> = {}): UserMemory => ({
  user: { id: 'u', firstName: 'דניאל', addressAs: null, gender: null, notes: null, phoneHash: null, createdAt: now, updatedAt: now },
  deceased: [],
  companion: [],
  recentSummaries: [],
  ...over,
});

describe('PHONE_INSTRUCTIONS', () => {
  it('tells the agent speech recognition may be wrong and to ask to repeat', () => {
    expect(PHONE_INSTRUCTIONS).toContain('טלפון');
    expect(PHONE_INSTRUCTIONS).toContain('תגידי שוב');
  });

  it('forces answering name questions from memory and forbids filler', () => {
    expect(PHONE_INSTRUCTIONS).toContain('איך קוראים לי');
    expect(PHONE_INSTRUCTIONS).toContain('מהזיכרון');
  });
});

describe('buildTranscriptionPrompt', () => {
  it('contains the caller and deceased names plus the fixed terms', () => {
    const prompt = buildTranscriptionPrompt(
      memory({ deceased: [{ id: 'd', userId: 'u', name: 'יצחק', relationship: null, dateOfDeath: null, circumstances: null, notes: null, createdAt: now }] }),
    );
    expect(prompt).toContain('דניאל');
    expect(prompt).toContain('יצחק');
    expect(prompt).toContain('עידו מסאלה');
  });

  it('works without memory', () => {
    expect(buildTranscriptionPrompt(null)).toContain('עידו מסאלה');
  });

  it('stays under 200 characters even with many names', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: String(i), userId: 'u', name: `שם-ארוך-מאוד-${i}`, relationship: null, dateOfDeath: null, circumstances: null, notes: null, createdAt: now,
    }));
    expect(buildTranscriptionPrompt(memory({ deceased: many })).length).toBeLessThanOrEqual(200);
  });
});
