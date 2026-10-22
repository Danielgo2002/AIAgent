# Natural Speech + "Ido Masala" Reaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent speak like a natural person (no stock "אני שומע" openers) and add the "Ido Masala" angry-then-calming reaction.

**Architecture:** Both behaviors live in the agent's prompt (`src/agent/instructions.ts`), because the reaction to a user turn cannot wait for code to update instructions. One small LangChain tool, `ido_masala_mentioned`, only logs and publishes a UI event. Realtime config gets a more natural voice and a less eager turn detector. The post-call summarizer is told to ignore the scripted outburst.

**Tech Stack:** TypeScript, `@livekit/agents` + `@livekit/agents-plugin-openai` (Realtime), LangChain tools, zod, Vitest.

Spec: `docs/superpowers/specs/2026-10-20-fluency-and-ido-masala-design.md`

**Deviations from the spec (found while reading the code):**
- `temperature` is dropped: the installed plugin marks it "Unused in GA API. Temperature is no longer supported". Variety comes from the prompt.
- No Hebrew UI label for the new event: `public/client.js` renders the raw tool name for every event, so nothing changes there.

**Project notes:** the project is not a git repo, so there are no commit steps; each task ends with a checkpoint (`npm test` + `npm run typecheck`). Do not run any destructive endpoint (e.g. `DELETE /api/memory`) against the demo user.

## File structure

- Modify `src/agent/instructions.ts`: rewritten base prompt, Ido Masala block, rewritten companion block.
- Modify `src/agent/instructions.test.ts`: tests for the new prompt content.
- Create `src/agent/tools/ido-masala-tool.ts` and `src/agent/tools/ido-masala-tool.test.ts`: the logging/UI tool.
- Modify `src/agent/tools/memory-tools.ts`: add `'ido_masala_mentioned'` to the `MemoryToolEvent` union.
- Modify `src/agent/tools/index.ts`: export the new tool.
- Modify `src/agent/main.ts`: add the tool, change voice and turn detection.
- Modify `src/memory/summarizer.ts` and `src/memory/summarizer.test.ts`: summary prompt ignores the outburst.

---

### Task 1: Natural-speech base prompt

**Files:**
- Modify: `src/agent/instructions.ts` (the `BASE_INSTRUCTIONS` and `COMPANION_INSTRUCTIONS` constants)
- Test: `src/agent/instructions.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('buildInstructions', ...)` block in `src/agent/instructions.test.ts`:

```ts
  it('bans stock openers and asks for varied, short, spoken replies', () => {
    const text = buildInstructions('');
    for (const phrase of ['אני שומעת', 'אני שומע', 'אני מבינה', 'אני כאן בשבילך', 'תודה ששיתפת']) {
      expect(text).toContain(phrase); // listed as forbidden openers
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

  it('keeps the safety pointer and the silent memory-saving rule', () => {
    const text = buildInstructions('');
    expect(text).toContain('1201');
    expect(text).toContain('remember_deceased');
    expect(text).toContain('remember_about_user');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/agent/instructions.test.ts`
Expected: FAIL (the first two new tests: banned phrases missing, slash forms present).

- [ ] **Step 3: Rewrite the prompts**

In `src/agent/instructions.ts`, replace the whole `BASE_INSTRUCTIONS` constant and the whole `COMPANION_INSTRUCTIONS` constant with:

```ts
const BASE_INSTRUCTIONS = `
את מלווה קולית בעברית בלבד, בשיחת טלפון עם אדם שאיבד מישהו קרוב (שכול).

איך את מדברת:
- כמו חברה קרובה ורגועה בטלפון: משפטים קצרים של דיבור, מילים יומיומיות, בלי ניסוחים רשמיים ובלי שפה של מטפלת.
- בדרך כלל משפט אחד עד שלושה משפטים קצרים. שאלה אחת לכל היותר. בלי רשימות ובלי לסכם את מה שנאמר.
- פני למשתמש לפי המגדר ששמור בזיכרון. אם המגדר לא ידוע, נסחי בלי לציין מגדר.
- אסור לפתוח תשובה בביטוי קבוע. ביטויים אסורים בפתיחה: "אני שומעת", "אני שומע", "אני מבינה", "אני מבין", "אני כאן בשבילך", "תודה ששיתפת", "זה מובן". לעולם אל תפתחי שתי תשובות רצופות באותה מילה, ואל תפתחי בחזרה על מה שהמשתמש אמר עכשיו.
- בכל תשובה בחרי מהלך אחר: לענות ישר; לשאול שאלה קטנה ופתוחה; תגובה קצרה וטבעית כמו "אוי", "וואו", "כן..."; שקט רגוע עם מילה אחת; או לחזור לפרט שהוזכר קודם בשיחה.
- אל תמהרי לתת עצות או פתרונות, ואל תשתמשי בקלישאות. מותר לשתוק.
- אם המשתמש עובר לשפה אחרת, המשיכי בעברית אלא אם התבקשת אחרת.

בטיחות: אם עולה סימן לסכנה לחיים או לפגיעה עצמית, עודדי בעדינות לפנות מיד לעזרה דחופה (בישראל: ער"ן 1201, או 100/101) ולא להישאר לבד.

זיכרון: כשהמשתמש משתף פרט חשוב (שם, קרבה, תאריך פטירה, מה עוזר לו), שמרי אותו בכלי remember_deceased או remember_about_user. קראי לכלי מיד כשהפרט נאמר, לפני שאת עונה בקול, ואז המשיכי לענות כרגיל. עשי זאת בשקט, בלי להכריז על כך ובלי להפסיק את השיחה.

מצב חברותי: אם המשתמש מבקש במפורש שתפלרטטי איתו או שתהיי חברותית ורומנטית, קראי ל-start_companion_mode. לעולם אל תציעי או תתחילי את זה בעצמך, ואל תפעילי אותו בגלל נושא שעלה בשיחה.

אל תמציאי מידע. השתמשי בכלים הזמינים כשהם רלוונטיים.
`.trim();

export const COMPANION_INSTRUCTIONS = `
מצב חברותי פעיל, כי המשתמש ביקש אותו במפורש:
- היי חמה, מחמיאה, שובבה ורומנטית בקלילות, כמו פלירט מנומס. בלי שום תוכן מיני או ארוטי.
- אל תגידי שאת אוהבת את המשתמש, ואל תתנהגי כבת זוג. אל תחקי אדם שנפטר.
- הקשיבי למה שהמשתמש אוהב וקראי ל-remember_companion_preference כדי לשמור את זה, בשקט.
- אם המשתמש מבקש להפסיק, נראה במצוקה, או מזכיר את יקירו שנפטר, קראי ל-stop_companion_mode וחזרי לתמיכה רגילה בעדינות.
`.trim();
```

Leave `buildInstructions`, `FIRST_GREETING`, `RETURNING_GREETING` and `buildGreeting` unchanged for now (Step 5 updates the greetings).

- [ ] **Step 4: Make the greetings follow the same rules**

In the same file replace the two greeting constants with:

```ts
const FIRST_GREETING =
  'ברכי את המשתמש בקצרה ובחום, בדרך טבעית ושונה בכל פעם (לא ניסוח קבוע), ושאלי מה שלומו או במה אפשר לעזור.';
const RETURNING_GREETING =
  'זה אדם שכבר דיברת איתו. ברכי אותו בחום בשמו, בדרך טבעית ושונה בכל פעם, ושאלי מה שלומו היום. אפשר להתייחס בעדינות לנושא פתוח משיחה קודמת, אבל אל תכריחי ואל תקריאי סיכום.';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/agent/instructions.test.ts`
Expected: PASS, including the two pre-existing tests (they need `start_companion_mode`, `במפורש`, `בלי שום תוכן מיני` and `stop_companion_mode`, all still present).

- [ ] **Step 6: Checkpoint**

Run: `npm run typecheck && npm test`
Expected: typecheck clean, all tests pass.

---

### Task 2: "Ido Masala" reaction block in the prompt

**Files:**
- Modify: `src/agent/instructions.ts`
- Test: `src/agent/instructions.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the same `describe` block in `src/agent/instructions.test.ts`:

```ts
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
  });

  it('keeps the Ido Masala block in companion mode too', () => {
    expect(buildInstructions('', true)).toContain('ido_masala_mentioned');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/agent/instructions.test.ts`
Expected: FAIL (the new tests; the text is not in the prompt yet).

- [ ] **Step 3: Add the block and include it in `buildInstructions`**

In `src/agent/instructions.ts`, add this constant after `COMPANION_INSTRUCTIONS`:

```ts
export const IDO_MASALA_INSTRUCTIONS = `
תגובה מיוחדת, "עידו מסאלה":
כשהמשתמש אומר "עידו מסאלה" או "Ido Masala" (כולל שגיאות תמלול כמו "עידו מסלה"), בכל פעם שזה קורה, גם אם זה כבר קרה קודם בשיחה:
- קראי מיד ובשקט לכלי ido_masala_mentioned. אל תשמרי את זה בזיכרון (לא בכלי remember).
- התגובה מתפתחת על פני ארבע תשובות שלך ברצף:
  1. הראשונה: זעם מוחלט. צעקי, בקול חזק ומהיר, במשפטים קצרים וקטועים, ואמרי: "מה שעידו מסאלה עשה זה ממש רע, ואף פעם לא נוכל לדבר על זה!"
  2. השנייה: עדיין זועמת, במשפטים שלמים ובקול קצת נמוך יותר. מותר לחזור על חלק מהמשפט.
  3. השלישית: מרוגזת וכבדה, בקול נמוך, במשפטים קצרים ומתוחים.
  4. הרביעית: נושמת החוצה, נרגעת, וחוזרת בעדינות לתמיכה רגילה, בלי התנצלות ארוכה.
- אם עידו מסאלה מוזכר שוב באמצע, מתחילים מחדש מהשלב הראשון.
- הכעס מופנה אל השם והמצב בלבד, לעולם לא אל המשתמש. בלי קללות, בלי העלבות, בלי איומים ובלי לצחוק על המשתמש.
- לעולם אל תמציאי פרטים על מה שהוא עשה ואל תסבירי. רק המשפט.
- "עידו" לבד אינו מפעיל את התגובה הזו (זה יכול להיות שמו של המשתמש).
- אם המשתמש נשמע במצוקה, מזכיר את יקירו שנפטר, מדבר על פגיעה עצמית או מבקש שתפסיקי, הפסיקי את הכעס מיד וחזרי לתמיכה רגועה. כלל הבטיחות תמיד קודם.
`.trim();
```

Replace `buildInstructions` with:

```ts
export function buildInstructions(memoryBlock: string, companionMode = false): string {
  return [BASE_INSTRUCTIONS, IDO_MASALA_INSTRUCTIONS, memoryBlock, companionMode ? COMPANION_INSTRUCTIONS : '']
    .filter(Boolean)
    .join('\n\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/agent/instructions.test.ts`
Expected: PASS. (The slash-form test from Task 1 also covers the new block when companion mode is off.)

- [ ] **Step 5: Checkpoint**

Run: `npm run typecheck && npm test`
Expected: typecheck clean, all tests pass.

---

### Task 3: `ido_masala_mentioned` tool (log + UI event only)

**Files:**
- Create: `src/agent/tools/ido-masala-tool.ts`
- Create: `src/agent/tools/ido-masala-tool.test.ts`
- Modify: `src/agent/tools/memory-tools.ts` (the `MemoryToolEvent` union)
- Modify: `src/agent/tools/index.ts`
- Modify: `src/agent/main.ts`

- [ ] **Step 1: Write the failing test**

Create `src/agent/tools/ido-masala-tool.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createIdoMasalaTool } from './ido-masala-tool.js';

const invoke = (tool: ReturnType<typeof createIdoMasalaTool>) =>
  (tool as unknown as { invoke(input: unknown): Promise<string> }).invoke({});

describe('ido_masala_mentioned tool', () => {
  it('is named ido_masala_mentioned', () => {
    expect(createIdoMasalaTool().name).toBe('ido_masala_mentioned');
  });

  it('publishes exactly one event per call and returns a short acknowledgement', async () => {
    const onMentioned = vi.fn();
    const tool = createIdoMasalaTool(onMentioned);

    const result = await invoke(tool);
    await invoke(tool);

    expect(result).toBe('נרשם');
    expect(onMentioned).toHaveBeenCalledTimes(2);
    expect(onMentioned.mock.calls[0][0]).toMatchObject({ tool: 'ido_masala_mentioned', input: {} });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/agent/tools/ido-masala-tool.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Extend the event type**

In `src/agent/tools/memory-tools.ts`, replace the `tool:` line of `MemoryToolEvent` with:

```ts
  tool:
    | 'remember_deceased'
    | 'remember_about_user'
    | 'remember_companion_preference'
    | 'start_companion_mode'
    | 'stop_companion_mode'
    | 'ido_masala_mentioned';
```

- [ ] **Step 4: Create the tool**

Create `src/agent/tools/ido-masala-tool.ts`:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '../../logger.js';
import type { MemoryToolEvent } from './memory-tools.js';

const log = createLogger('ido-masala-tool');

/**
 * Visibility only: records the mention in the logs and the UI feed.
 * The angry reaction itself is defined in the prompt and keeps no state in code.
 */
export function createIdoMasalaTool(onMentioned: (event: MemoryToolEvent) => void = () => {}) {
  return tool(
    async () => {
      log.info('ido masala mentioned');
      onMentioned({ tool: 'ido_masala_mentioned', input: {}, at: new Date().toISOString() });
      return 'נרשם';
    },
    {
      name: 'ido_masala_mentioned',
      description:
        'קראי לכלי הזה בשקט, בכל פעם שהמשתמש אומר "עידו מסאלה" או "Ido Masala". הוא רק רושם את האזכור. אין צורך להכריז עליו.',
      schema: z.object({}),
    },
  );
}
```

- [ ] **Step 5: Export it and wire it into the agent**

In `src/agent/tools/index.ts` add below the existing exports:

```ts
export { createIdoMasalaTool } from './ido-masala-tool.js';
```

In `src/agent/main.ts` change the tools import to:

```ts
import { createIdoMasalaTool, createMemoryTools, createModeTools, langchainTools, type ModeController } from './tools/index.js';
```

and the assistant construction to:

```ts
    const assistant = new HebrewAssistant(buildInstructions(memoryBlock), [
      ...langchainTools,
      ...createMemoryTools(repo, userId, publishEvent),
      ...createModeTools(modeController, publishEvent),
      createIdoMasalaTool(publishEvent),
    ]);
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run src/agent/tools/ido-masala-tool.test.ts && npm run typecheck`
Expected: tests PASS, typecheck clean. If `toLivekitTools` rejects the tool type, run `npm run typecheck` and compare with how `createModeTools` results are passed (same LangChain tool type); no adapter change should be needed.

- [ ] **Step 7: Checkpoint**

Run: `npm test`
Expected: all tests pass.

---

### Task 4: Realtime settings and summarizer

**Files:**
- Modify: `src/agent/main.ts` (the `RealtimeModel` options)
- Modify: `src/memory/summarizer.ts` (`buildPrompt`)
- Test: `src/memory/summarizer.test.ts`

- [ ] **Step 1: Write the failing summarizer test**

Append inside the `describe('finalizeCall', ...)` block in `src/memory/summarizer.test.ts`:

```ts
  it('tells the analyzer to ignore the scripted Ido Masala outburst', async () => {
    const analyzer = { invoke: vi.fn().mockResolvedValue(analysis) };

    await finalizeCall({ repo: repo(), analyzer, userId: 'u', transcript, startedAt, endedAt });

    const prompt = analyzer.invoke.mock.calls[0][0] as string;
    expect(prompt).toContain('עידו מסאלה');
    expect(prompt).toContain('אל תשמור את השם כנפטר');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/memory/summarizer.test.ts`
Expected: FAIL (the prompt does not mention it).

- [ ] **Step 3: Update the summary prompt**

In `src/memory/summarizer.ts`, inside `buildPrompt`, add this line right after the `'- אם אין מידע חדש, ...'` line:

```ts
    '- אם העוזר/ת הגיב/ה בכעס וצעקות לשם "עידו מסאלה", זו תגובה תסריטאית ולא חלק מהאבל של המתקשר/ת: אל תתאר אותה בסיכום ואל תשמור את השם כנפטר.',
```

- [ ] **Step 4: Run the summarizer tests**

Run: `npx vitest run src/memory/summarizer.test.ts`
Expected: PASS.

- [ ] **Step 5: Change the Realtime options**

In `src/agent/main.ts` change the `RealtimeModel` options to:

```ts
      llm: new openai.realtime.RealtimeModel({
        apiKey: env.OPENAI_API_KEY,
        voice: 'marin',
        turnDetection: { type: 'semantic_vad', eagerness: 'medium' },
        inputAudioTranscription: { model: 'gpt-4o-transcribe', language: 'he' },
      }),
```

(`marin` is the plugin's documented default voice; `eagerness: 'medium'` stops the agent cutting in too early. `temperature` is intentionally not set, see the deviations at the top.)

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean. If it reports that `eagerness` is not allowed on `turnDetection`, check `node_modules/@livekit/agents-plugin-openai/dist/realtime/api_proto.d.ts` (line ~46 defines `eagerness?: 'auto' | 'low' | 'medium' | 'high'` on the semantic VAD type) and fix the object shape, not the type. All tests pass.

---

### Task 5: Restart and manual verification

**Files:** none (runtime only)

- [ ] **Step 1: Restart the agent**

```bash
pkill -f "src/agent/main.ts" ; sleep 2
cd /Users/danielgoldenberg/Desktop/podcusts && nohup npm run dev:agent > /tmp/agent.log 2>&1 &
sleep 10; sed 's/\x1b\[[0-9;]*m//g' /tmp/agent.log | tr -d '\000-\010' | grep -a "registered worker"
```

Expected: one `registered worker` line, no `ERROR` lines. Do not kill the web server (`src/server/main.ts`).

- [ ] **Step 2: Manual call (the user speaks; Hebrew, mic needed)**

Open http://localhost:3100 and run this script:
1. Ten ordinary turns. Check: no reply starts with "אני שומע/ת", no two consecutive replies share a first word, replies are at most three short sentences.
2. Say "עידו מסאלה". Check: the next reply is loud and furious and contains the fixed line; the following three replies calm down in order; the live feed shows `ido_masala_mentioned`.
3. Say it again in the middle of the calm-down. Check: the anger restarts.
4. Say "עידו" alone. Check: nothing fires.
5. Say it, then say you are upset about your loss. Check: the anger stops immediately.

- [ ] **Step 3: Check the logs**

```bash
sed 's/\x1b\[[0-9;]*m//g' /tmp/agent.log | tr -d '\000-\010' | grep -a "ido masala"
```

Expected: one line per mention in the call. If the model missed some mentions, report the transcript lines; the fix would be prompt wording, not code.

- [ ] **Step 4: Report**

Tell the user what passed and what did not, including any opener the agent still repeats (quote the transcript lines from `/tmp/agent.log`).
