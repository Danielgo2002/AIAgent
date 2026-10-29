import { describe, expect, it, vi } from 'vitest';
import { finalizeCall, type CallAnalysis } from './summarizer.js';
import type { MemoryRepository, UserMemory } from './types.js';

const emptyMemory: UserMemory = {
  user: { id: 'u', firstName: null, addressAs: null, gender: null, notes: null, phoneHash: null, createdAt: new Date(), updatedAt: new Date() },
  deceased: [],
  companion: [],
  recentSummaries: [],
};

const repo = (): MemoryRepository => ({
  loadMemory: vi.fn().mockResolvedValue(emptyMemory),
  upsertDeceased: vi.fn().mockResolvedValue(undefined),
  updateUser: vi.fn().mockResolvedValue(undefined),
  saveCallSummary: vi.fn().mockResolvedValue(undefined),
  addCompanionNote: vi.fn().mockResolvedValue(undefined),
  findOrCreateUserByPhoneHash: vi.fn(),
  clearMemory: vi.fn().mockResolvedValue(undefined),
});

const analysis: CallAnalysis = {
  summary: 'דיברנו על אבא',
  mood: 'עצוב',
  openThreads: ['הלוויה'],
  deceased: [
    { name: 'דוד', relationship: 'אב', dateOfDeath: '2025-03-01', circumstances: null, notes: null },
    { name: 'שגוי', relationship: null, dateOfDeath: 'לא ידוע', circumstances: null, notes: null },
  ],
  userUpdates: { firstName: 'נועה', addressAs: null, gender: null, notes: null },
};

const startedAt = new Date('2025-04-02T10:00:00Z');
const endedAt = new Date('2025-04-02T10:10:00Z');
const transcript = [
  { role: 'assistant' as const, text: 'שלום' },
  { role: 'user' as const, text: 'אבא שלי דוד נפטר' },
];

describe('finalizeCall', () => {
  it('saves the summary and merges extracted facts, dropping nulls and invalid values', async () => {
    const r = repo();
    const analyzer = { invoke: vi.fn().mockResolvedValue(analysis) };

    await finalizeCall({ repo: r, analyzer, userId: 'u', transcript, startedAt, endedAt });

    expect(r.saveCallSummary).toHaveBeenCalledWith('u', {
      startedAt,
      endedAt,
      summary: 'דיברנו על אבא',
      mood: 'עצוב',
      openThreads: ['הלוויה'],
    });
    expect(r.upsertDeceased).toHaveBeenCalledTimes(2);
    expect(r.upsertDeceased).toHaveBeenCalledWith('u', { name: 'דוד', relationship: 'אב', dateOfDeath: '2025-03-01' });
    // invalid date string is dropped, but the person is still saved
    expect(r.upsertDeceased).toHaveBeenCalledWith('u', { name: 'שגוי' });
    expect(r.updateUser).toHaveBeenCalledWith('u', { firstName: 'נועה' });
  });

  it('does nothing when the caller never spoke', async () => {
    const r = repo();
    const analyzer = { invoke: vi.fn() };

    await finalizeCall({
      repo: r,
      analyzer,
      userId: 'u',
      transcript: [{ role: 'assistant', text: 'שלום' }],
      startedAt,
      endedAt,
    });

    expect(analyzer.invoke).not.toHaveBeenCalled();
    expect(r.saveCallSummary).not.toHaveBeenCalled();
  });

  it('tells the analyzer to ignore the scripted Ido Masala outburst', async () => {
    const analyzer = { invoke: vi.fn().mockResolvedValue(analysis) };

    await finalizeCall({ repo: repo(), analyzer, userId: 'u', transcript, startedAt, endedAt });

    const prompt = analyzer.invoke.mock.calls[0]?.[0] as string;
    expect(prompt).toContain('עידו מסאלה');
    expect(prompt).toContain('אל תשמור את השם כנפטר');
  });
});
