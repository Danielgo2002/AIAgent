import { describe, expect, it } from 'vitest';
import { formatMemory } from '../memory/memory-formatter.js';
import type { UserMemory } from '../memory/types.js';
import { buildGreeting, buildInstructions, COMPANION_INSTRUCTIONS } from './instructions.js';
import { PHONE_INSTRUCTIONS } from './phone-profile.js';

describe('buildInstructions', () => {
  it('only requests the companion mode on explicit user request', () => {
    const text = buildInstructions('');
    expect(text).toContain('start_companion_mode');
    expect(text).toContain('במפורש');
    expect(text).not.toContain(COMPANION_INSTRUCTIONS);
  });

  it('adds the SFW companion block, with exit conditions, only when the mode is on', () => {
    const text = buildInstructions('זיכרון', true);
    expect(text).toContain('זיכרון');
    expect(text).toContain(COMPANION_INSTRUCTIONS);
    expect(COMPANION_INSTRUCTIONS).toContain('בלי שום תוכן מיני');
    expect(COMPANION_INSTRUCTIONS).toContain('stop_companion_mode');
  });

  it('bans stock openers and asks for varied, short, spoken replies', () => {
    const text = buildInstructions('');
    const marker = 'ביטויים אסורים בפתיחה:';
    expect(text).toContain(marker);
    const banList = (text.split(marker)[1] ?? '').split('\n')[0] ?? '';
    for (const phrase of ['אני שומעת', 'אני שומע', 'אני מבינה', 'אני מבין', 'אני כאן בשבילך', 'תודה ששיתפת', 'זה מובן']) {
      expect(banList).toContain(phrase);
    }
    expect(text).toContain('אסור לפתוח');
    expect(text).toContain('שתי תשובות רצופות');
    expect(text).not.toContain('לשקף');
  });

  it('has no slash gender forms in the persona prompts', () => {
    const slashForm = /[א-ת]\/[א-ת]/;
    expect(buildInstructions('')).not.toMatch(slashForm);
    expect(COMPANION_INSTRUCTIONS).not.toMatch(slashForm);
  });

  it('has no slash or parenthesized gender forms in the full prompt with memory', () => {
    const now = new Date();
    const sample: UserMemory = {
      user: { id: 'u1', firstName: 'נועה', addressAs: 'נועה', gender: 'female', notes: 'מעדיפה שקט', phoneHash: null, phoneLast4: null, createdAt: now, updatedAt: now },
      deceased: [
        { id: 'd1', userId: 'u1', name: 'דוד', relationship: 'אב', dateOfDeath: '2025-03-01', circumstances: null, notes: 'אהב שחמט', createdAt: now },
      ],
      companion: [{ id: 'c1', userId: 'u1', category: 'likes', note: 'מוזיקה ים תיכונית', createdAt: now }],
      recentSummaries: [
        { id: 's1', userId: 'u1', startedAt: now, endedAt: now, summary: 'דיברנו על ההלוויה', mood: 'עצובה', openThreads: ['שיחה עם האחות'], createdAt: now },
      ],
    };
    const text = buildInstructions(formatMemory(sample), true).replace('100/101', '');
    expect(text).not.toMatch(/[א-ת]\/[א-ת]/);
    expect(text).not.toMatch(/[א-ת]\([הת]\)|[א-ת]\/י\b|\bי\)/);
  });

  it('keeps the safety pointer and the silent memory-saving rule', () => {
    const text = buildInstructions('');
    expect(text).toContain('1201');
    expect(text).toContain('100/101');
    expect(text).toContain('remember_deceased');
    expect(text).toContain('remember_about_user');
  });

  it('varies greetings and avoids masculine-only address', () => {
    for (const has of [true, false]) {
      const g = buildGreeting(has);
      expect(g).toContain('שונה בכל פעם');
      expect(g).not.toContain('שלומו');
    }
  });

  it('defines the Ido Masala reaction: trigger, fixed line, four-step arc and guardrails', () => {
    const text = buildInstructions('');
    expect(text).toContain('עידו מסאלה');
    expect(text).toContain('Ido Masala');
    expect(text).toContain('ido_masala_mentioned');
    expect(text).toContain('מה שעידו מסאלה עשה זה ממש רע, ואף פעם לא נוכל לדבר על זה');
    expect(text).toContain('מתחילים מחדש');
    expect(text).toContain('לעולם לא אל המשתמש');
    expect(text).toContain('"עידו" לבד אינו מפעיל');
    expect(text).toContain('אל תשמרי את זה בזיכרון');
    expect(text).toContain('הפסיקי את הכעס מיד');
    expect(text).toContain('לפני שאת עונה בקול');
    expect(text).toContain('גם אם המצב החברותי פעיל');
    expect(text).toContain('לא יותר');
  });

  it('keeps the Ido Masala block in companion mode too', () => {
    expect(buildInstructions('', true)).toContain('ido_masala_mentioned');
  });

  it('places the Ido Masala block before memory and companion text, with precedence rules', () => {
    const t = buildInstructions('MEMORY_X');
    expect(t.indexOf('ido_masala_mentioned')).toBeLessThan(t.indexOf('MEMORY_X'));
    const c = buildInstructions('MEMORY_X', true);
    expect(c.indexOf('ido_masala_mentioned')).toBeLessThan(c.indexOf('MEMORY_X'));
    expect(c.indexOf('MEMORY_X')).toBeLessThan(c.indexOf(COMPANION_INSTRUCTIONS));
    expect(t).toContain('גוברת על כללי הסגנון');
    expect(t).toContain('קריאת הכלי אינה תשובה');
    expect(t).toContain('הקשת מבוטלת');
    expect(t).toContain('עידו מסלה');
  });
});

describe('buildInstructions phone profile', () => {
  it('adds the phone block only when isPhone is true', () => {
    expect(buildInstructions('', false, true)).toContain(PHONE_INSTRUCTIONS);
    expect(buildInstructions('', false, false)).not.toContain(PHONE_INSTRUCTIONS);
    expect(buildInstructions('')).not.toContain(PHONE_INSTRUCTIONS);
  });

  it('keeps the phone block when companion mode is on', () => {
    const text = buildInstructions('', true, true);
    expect(text).toContain(PHONE_INSTRUCTIONS);
    expect(text).toContain('מצב חברותי');
  });
});
