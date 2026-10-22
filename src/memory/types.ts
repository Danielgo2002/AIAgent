import { z } from 'zod';
import { COMPANION_CATEGORIES, type callSummaries, type companionPreferences, type deceased, type users } from './schema.js';

export const deceasedInputSchema = z.object({
  name: z.string().min(1).describe('שם האדם שנפטר'),
  relationship: z.string().optional().describe('הקרבה למשתמש, למשל אב, אחות, בן זוג'),
  dateOfDeath: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('תאריך הפטירה בפורמט YYYY-MM-DD'),
  circumstances: z.string().optional().describe('נסיבות הפטירה, רק אם המשתמש שיתף'),
  notes: z.string().optional().describe('פרט אישי חשוב על הנפטר/ת או על הקשר איתו/ה'),
});
export type DeceasedInput = z.infer<typeof deceasedInputSchema>;

export const userUpdateSchema = z.object({
  firstName: z.string().optional().describe('שם פרטי'),
  addressAs: z.string().optional().describe('איך המשתמש מעדיף שיפנו אליו'),
  gender: z.enum(['male', 'female', 'other']).optional().describe('מגדר, לצורך פנייה נכונה בעברית'),
  notes: z.string().optional().describe('מה עוזר למשתמש, או נושאים להימנע מהם'),
});
export type UserUpdate = z.infer<typeof userUpdateSchema>;

export const companionNoteSchema = z.object({
  category: z
    .enum(COMPANION_CATEGORIES)
    .describe('likes=מה אוהב/ת, style=סגנון שמתאים, address=איך לפנות, avoid=ממה להימנע, smiles=מה מצחיק/משמח, other'),
  note: z.string().min(1).describe('ההעדפה עצמה, במשפט קצר'),
});
export type CompanionNote = z.infer<typeof companionNoteSchema>;

export interface CallSummaryInput {
  startedAt: Date;
  endedAt: Date;
  summary: string;
  mood?: string;
  openThreads: string[];
}

export interface UserMemory {
  user: typeof users.$inferSelect;
  deceased: (typeof deceased.$inferSelect)[];
  companion: (typeof companionPreferences.$inferSelect)[];
  /** Most recent first. */
  recentSummaries: (typeof callSummaries.$inferSelect)[];
}

export interface MemoryRepository {
  loadMemory(userId: string): Promise<UserMemory>;
  upsertDeceased(userId: string, input: DeceasedInput): Promise<void>;
  updateUser(userId: string, input: UserUpdate): Promise<void>;
  addCompanionNote(userId: string, input: CompanionNote): Promise<void>;
  saveCallSummary(userId: string, input: CallSummaryInput): Promise<void>;
  /** Deletes the user and, by cascade, all their memory. */
  clearMemory(userId: string): Promise<void>;
}
