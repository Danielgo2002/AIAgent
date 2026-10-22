import { tool } from '@langchain/core/tools';
import type { MemoryRepository } from '../../memory/types.js';
import { createLogger } from '../../logger.js';
import { companionNoteSchema, deceasedInputSchema, userUpdateSchema } from '../../memory/types.js';

const log = createLogger('memory-tools');

const SAVED = 'נשמר';
const FAILED = 'לא הצלחתי לשמור כרגע. המשיכי בשיחה כרגיל ואל תזכירי את זה.';

export interface MemoryToolEvent {
  tool:
    | 'remember_deceased'
    | 'remember_about_user'
    | 'remember_companion_preference'
    | 'start_companion_mode'
    | 'stop_companion_mode'
    | 'ido_masala_mentioned';
  input: Record<string, unknown>;
  at: string;
}

/**
 * Tools that let the voice model save important facts while the call is in progress.
 * `onSaved` fires after each successful save (used to surface the event in the UI).
 */
export function createMemoryTools(
  repo: MemoryRepository,
  userId: string,
  onSaved: (event: MemoryToolEvent) => void = () => {},
) {
  const safely = async (name: MemoryToolEvent['tool'], input: object, save: () => Promise<void>) => {
    const started = Date.now();
    log.info({ tool: name, input }, 'memory tool called');
    try {
      await save();
      log.info({ tool: name, ms: Date.now() - started }, 'memory saved');
      onSaved({ tool: name, input: { ...input }, at: new Date().toISOString() });
      return SAVED;
    } catch (err) {
      log.error({ err, tool: name, ms: Date.now() - started }, 'memory tool failed');
      return FAILED;
    }
  };

  const rememberDeceased = tool(
    async (input) => safely('remember_deceased', input, () => repo.upsertDeceased(userId, input)),
    {
      name: 'remember_deceased',
      description:
        'שמרי פרטים על אדם יקר שנפטר כשהמשתמש משתף אותם: שם, קרבה, תאריך פטירה, נסיבות, או פרט אישי. אפשר לקרוא שוב עם אותו שם כדי להוסיף פרטים. קראי בשקט, בלי להכריז על כך.',
      schema: deceasedInputSchema,
    },
  );

  const rememberAboutUser = tool(
    async (input) => safely('remember_about_user', input, () => repo.updateUser(userId, input)),
    {
      name: 'remember_about_user',
      description:
        'שמרי פרטים על המשתמש עצמו: שם, איך לפנות אליו, מגדר, מה עוזר או ממה להימנע. קראי בשקט, בלי להכריז על כך.',
      schema: userUpdateSchema,
    },
  );

  const rememberCompanionPreference = tool(
    async (input) =>
      safely('remember_companion_preference', input, () => repo.addCompanionNote(userId, input)),
    {
      name: 'remember_companion_preference',
      description:
        'במצב החברותי בלבד: שמרי העדפה של המשתמש (מה הוא אוהב, איזה סגנון מתאים, איך לפנות, ממה להימנע, מה משמח). קראי בשקט, בלי להכריז על כך.',
      schema: companionNoteSchema,
    },
  );

  return [rememberDeceased, rememberAboutUser, rememberCompanionPreference];
}
