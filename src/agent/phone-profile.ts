import type { UserMemory } from '../memory/types.js';

export const PHONE_INSTRUCTIONS = `
השיחה הזו בטלפון, והזיהוי הקולי עלול לטעות או לקלוט רק חלק מהמשפט.
- אם מה שנקלט לא מובן, נשמע חתוך או לא קשור לשום דבר, אל תעני במשפט הזדהות כללי. בקשי בטבעיות ובקצרה שיחזרו: "לא שמעתי טוב, תגידי שוב?" (בפנייה בלשון המתאימה למשתמש).
- שאלות כמו "איך קוראים לי", "מי נפטר", "מה סיפרתי לך" נענות ישירות מהזיכרון שבהוראות. אם אין שם תשובה, אמרי את זה בפשטות ואל תמציאי.
- כל שאר הכללים (סגנון, קיצור, בטיחות) נשארים בתוקף.
`.trim();

const FIXED_TERMS = 'עידו מסאלה, אבל, שכול, יזכור';
const MAX_PROMPT_LENGTH = 200;

/** Short hint for the speech-to-text model: the caller's own names first, then a few fixed terms. */
export function buildTranscriptionPrompt(memory: UserMemory | null): string {
  const names = [memory?.user.firstName, ...(memory?.deceased.map((d) => d.name) ?? [])].filter(
    (n): n is string => Boolean(n),
  );
  const parts = ['שמות', ...names];
  let prompt = `${parts.join(', ')}. ${FIXED_TERMS}`;
  while (prompt.length > MAX_PROMPT_LENGTH && names.length > 0) {
    names.pop();
    prompt = `${['שמות', ...names].join(', ')}. ${FIXED_TERMS}`;
  }
  return prompt.slice(0, MAX_PROMPT_LENGTH);
}
