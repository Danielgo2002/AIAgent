import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import { formatMemory } from './memory-formatter.js';
import {
  deceasedInputSchema,
  userUpdateSchema,
  type MemoryRepository,
} from './types.js';

const log = createLogger('summarizer');

export interface TranscriptLine {
  role: 'user' | 'assistant';
  text: string;
}

// OpenAI structured output requires every field present, so optional values are nullable here
// and converted back to "missing" by `withoutNulls` before they reach the repository.
const analysisSchema = z.object({
  summary: z.string().describe('סיכום חופשי בעברית של השיחה, 3 עד 6 משפטים, בגוף שלישי'),
  mood: z.string().nullable().describe('מצב הרוח של המתקשר/ת בקצרה, או null'),
  openThreads: z.array(z.string()).describe('נושאים שכדאי לחזור אליהם בשיחה הבאה'),
  deceased: z.array(
    z.object({
      name: z.string(),
      relationship: z.string().nullable(),
      dateOfDeath: z.string().nullable().describe('YYYY-MM-DD, או null אם לא ידוע'),
      circumstances: z.string().nullable(),
      notes: z.string().nullable(),
    }),
  ),
  userUpdates: z.object({
    firstName: z.string().nullable(),
    addressAs: z.string().nullable(),
    gender: z.enum(['male', 'female', 'other']).nullable(),
    notes: z.string().nullable(),
  }),
});
export type CallAnalysis = z.infer<typeof analysisSchema>;

/** Anything with an `invoke(prompt)` that returns a CallAnalysis (a LangChain structured-output runnable, or a test stub). */
export interface CallAnalyzer {
  invoke(input: string): Promise<CallAnalysis>;
}

export function createOpenAiAnalyzer(apiKey: string): CallAnalyzer {
  return new ChatOpenAI({ model: 'gpt-4.1-mini', apiKey, temperature: 0 }).withStructuredOutput(
    analysisSchema,
  );
}

const deceasedWithoutDateSchema = deceasedInputSchema.omit({ dateOfDeath: true });

const withoutNulls = <T extends object>(input: T) =>
  Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null && v !== undefined));

function buildPrompt(transcript: TranscriptLine[], known: string): string {
  const lines = transcript.map((l) => `${l.role === 'user' ? 'מתקשר/ת' : 'עוזר/ת'}: ${l.text}`).join('\n');
  return [
    'להלן תמלול שיחת תמיכה עם אדם שאיבד יקיר/ה. נתח אותו.',
    '- כתוב סיכום קצר ועובדתי בעברית.',
    '- החזר ב-deceased וב-userUpdates רק מידע חדש שהמתקשר/ת אמר/ה בפירוש בשיחה הזו. אל תמציא ואל תחזור על מה שכבר ידוע.',
    '- אם אין מידע חדש, החזר רשימה ריקה / null בכל השדות.',
    '- אם העוזר/ת הגיב/ה בכעס וצעקות לשם "עידו מסאלה", זו תגובה תסריטאית ולא חלק מהאבל של המתקשר/ת: אל תתאר אותה בסיכום ואל תשמור את השם כנפטר.',
    known ? `\nמידע שכבר שמור:\n${known}` : '',
    `\nתמלול:\n${lines}`,
  ].join('\n');
}

export interface FinalizeCallParams {
  repo: MemoryRepository;
  analyzer: CallAnalyzer;
  userId: string;
  transcript: TranscriptLine[];
  startedAt: Date;
  endedAt: Date;
}

/** Writes the call summary and merges any facts the live tools missed. */
export async function finalizeCall({ repo, analyzer, userId, transcript, startedAt, endedAt }: FinalizeCallParams) {
  if (!transcript.some((l) => l.role === 'user')) {
    log.info({ lines: transcript.length }, 'no user speech, skipping call summary');
    return;
  }

  const started = Date.now();
  log.info({ lines: transcript.length }, 'analysing call');
  const memory = await repo.loadMemory(userId);
  const analysis = await analyzer.invoke(buildPrompt(transcript, formatMemory(memory)));
  log.info(
    { ms: Date.now() - started, deceased: analysis.deceased.length, openThreads: analysis.openThreads.length },
    'call analysed',
  );

  await repo.saveCallSummary(userId, {
    startedAt,
    endedAt,
    summary: analysis.summary,
    mood: analysis.mood ?? undefined,
    openThreads: analysis.openThreads,
  });

  for (const person of analysis.deceased) {
    const parsed = deceasedInputSchema.safeParse(withoutNulls(person));
    if (parsed.success) {
      await repo.upsertDeceased(userId, parsed.data);
      continue;
    }
    // e.g. a malformed date: keep the person, drop the bad fields
    const { name, relationship, circumstances, notes } = person;
    const fallback = deceasedWithoutDateSchema.safeParse(withoutNulls({ name, relationship, circumstances, notes }));
    if (fallback.success) await repo.upsertDeceased(userId, fallback.data);
  }

  const userUpdate = userUpdateSchema.safeParse(withoutNulls(analysis.userUpdates));
  if (userUpdate.success && Object.keys(userUpdate.data).length > 0) {
    await repo.updateUser(userId, userUpdate.data);
  }
  log.info({ ms: Date.now() - started }, 'call summary saved');
}
