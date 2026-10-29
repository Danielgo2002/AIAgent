# Phone Quality and Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make phone calls sound and answer better, push live memory events from phone calls to the dashboard, and replace the single-user page with a token-protected, searchable multi-user dashboard.

**Architecture:** Part A adds a SIP-only profile (phone instructions block, transcription hint from memory, switchable audio cleanup). Part B sends agent events through Postgres `NOTIFY`; the server holds one `LISTEN` connection and streams events as server-sent events. Part C adds `users.phone_last4`, three read/delete repository methods, token-protected admin routes, and a modular front end.

**Tech Stack:** TypeScript/Node, Fastify, Drizzle + `pg`, Vitest, zod, LiveKit Agents JS 1.9.2 with `@livekit/agents-plugin-openai`, plain ES-module front end (no build step).

**Spec:** `docs/superpowers/specs/2026-10-29-phone-quality-and-admin-dashboard-design.md`

**Rules for every task:**
- Never print `.env` values, phone numbers or hashes. Never run `DELETE`/`clearMemory`/`deleteUser` against the real database; tests use the `podcusts_test` database through `createTestRepo()`.
- Do not push to GitHub; do not run `npm run db:migrate` (the controller does that).
- Commit messages end with: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- Part A tasks (A1-A4) and Part B/C tasks (B1-B8) are independent in code. Run A first, then B/C, in the order written.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/agent/phone-profile.ts` (+test) | Create | `PHONE_INSTRUCTIONS`, `buildTranscriptionPrompt` |
| `src/agent/instructions.ts` (+test) | Modify | `buildInstructions(memoryBlock, companionMode, isPhone)` |
| `src/config/env.ts` | Modify | `PHONE_AUDIO_CLEANUP`, `ADMIN_TOKEN` |
| `src/agent/main.ts` | Modify | Phone profile, cleanup, events, greeting diagnostics |
| `src/memory/schema.ts` + `drizzle/0003_*` | Modify/Generate | `users.phone_last4` |
| `src/memory/phone.ts` (+test) | Modify | `lastFour` |
| `src/memory/types.ts`, `memory-repository.ts` (+test) | Modify | last4, `listUsers`, `findMemory`, `deleteUser` |
| `src/memory/caller-identity.ts` (+test) | Modify | pass last 4 digits |
| `src/events/agent-events.ts` (+test) | Create | event type, `notifyAgentEvent`, `AgentEventListener` |
| `src/memory/test-support.ts` | Modify | export `TEST_DATABASE_URL` |
| `src/server/auth.ts` (+test) | Create | `isValidAdminToken` |
| `src/server/routes/admin.ts` (+test) | Create | users, memory, delete, events routes |
| `src/server/app.ts`, `main.ts` | Modify | wire it up |
| `public/index.html`, `public/js/*.js` | Create/Replace | dashboard, call, API client |
| `public/client.js` | Delete | replaced by modules |

---

## PART A: Phone sound and answers

### Task A1: Phone profile (instructions + transcription hint)

**Files:**
- Create: `src/agent/phone-profile.ts`, `src/agent/phone-profile.test.ts`
- Modify: `src/agent/instructions.ts`, `src/agent/instructions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/agent/phone-profile.test.ts`:

```ts
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
```

Add to `src/agent/instructions.test.ts` (inside the existing top-level describe for `buildInstructions`, or a new describe at the end of the file; add `import { PHONE_INSTRUCTIONS } from './phone-profile.js';` at the top):

```ts
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
```
(If the companion block does not contain the exact words `מצב חברותי`, use a distinctive phrase that `COMPANION_INSTRUCTIONS` really contains; check `src/agent/instructions.ts`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/agent/phone-profile.test.ts src/agent/instructions.test.ts`
Expected: FAIL (module/export missing).

- [ ] **Step 3: Implement `phone-profile.ts`**

Create `src/agent/phone-profile.ts`:

```ts
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
```

- [ ] **Step 4: Extend `buildInstructions`**

In `src/agent/instructions.ts` add `import { PHONE_INSTRUCTIONS } from './phone-profile.js';` and replace `buildInstructions` with:

```ts
export function buildInstructions(memoryBlock: string, companionMode = false, isPhone = false): string {
  return [
    BASE_INSTRUCTIONS,
    IDO_MASALA_INSTRUCTIONS,
    memoryBlock,
    isPhone ? PHONE_INSTRUCTIONS : '',
    companionMode ? COMPANION_INSTRUCTIONS : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
```

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all green. (Existing tests that assert order of blocks, for example that memory comes after the Ido block, must still pass because the phone block is empty by default.)

- [ ] **Step 6: Commit**

```bash
git add src/agent/phone-profile.ts src/agent/phone-profile.test.ts src/agent/instructions.ts src/agent/instructions.test.ts
git commit -m "feat: phone instruction block and transcription hint" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task A2: Wire the phone profile and switchable audio cleanup

**Files:**
- Modify: `src/config/env.ts`, `.env.example`, `src/agent/main.ts`

- [ ] **Step 1: Add the env setting**

In `src/config/env.ts` add inside the schema, after `PHONE_HASH_KEY`:

```ts
  PHONE_AUDIO_CLEANUP: z.enum(['none', 'openai', 'bvc']).default('none'),
```
Append to `.env.example`: `PHONE_AUDIO_CLEANUP=none`. Do not edit `.env` (the default applies).

- [ ] **Step 2: Keep the loaded memory and the channel in `main.ts`**

In `src/agent/main.ts`:
- Import `import type { UserMemory } from '../memory/types.js';`, and `import { buildTranscriptionPrompt } from './phone-profile.js';`.
- After the `participant` is obtained add `const isSip = participant.kind === ParticipantKind.SIP;` and use `isSip` in the existing `resolveUserId({ isSip: ... })` call.
- Before `let memoryBlock = '';` add `let memory: UserMemory | null = null;`, and inside the existing `try` change `const memory = await repo.loadMemory(userId);` to `memory = await repo.loadMemory(userId);` (the log line inside the try uses `memory.deceased` and `memory.recentSummaries`; keep it working).

- [ ] **Step 3: Phone-aware model options**

Replace the `new openai.realtime.RealtimeModel({ ... })` options with:

```ts
      llm: new openai.realtime.RealtimeModel({
        apiKey: env.OPENAI_API_KEY,
        voice: 'marin',
        turnDetection: { type: 'semantic_vad', eagerness: 'medium' },
        inputAudioTranscription: {
          model: 'gpt-4o-transcribe',
          language: 'he',
          ...(isSip ? { prompt: buildTranscriptionPrompt(memory) } : {}),
        },
        ...(isSip && env.PHONE_AUDIO_CLEANUP === 'openai'
          ? { inputAudioNoiseReduction: { type: 'near_field' as const } }
          : {}),
      }),
```
(Check `api_proto.NoiseReduction` in `node_modules/@livekit/agents-plugin-openai/dist/realtime/api_proto.d.ts`; if the shape is not `{ type }`, use the shape defined there.)

- [ ] **Step 4: Phone block in the instructions**

Change both `buildInstructions` calls in `main.ts`:
- `buildInstructions(memoryBlock, on)` becomes `buildInstructions(memoryBlock, on, isSip)`
- `buildInstructions(memoryBlock)` becomes `buildInstructions(memoryBlock, false, isSip)`

- [ ] **Step 5: Log the profile once per call**

After the `anonymous call` / `call started` log add:

```ts
    callLog.info({ isSip, cleanup: isSip ? env.PHONE_AUDIO_CLEANUP : 'n/a' }, 'channel profile');
```

- [ ] **Step 6: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/config/env.ts .env.example src/agent/main.ts
git commit -m "feat: phone transcription hint, phone instructions and switchable audio cleanup" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task A3: LiveKit telephony noise cancellation (`PHONE_AUDIO_CLEANUP=bvc`)

**Files:**
- Modify: `package.json`, `package-lock.json`, `src/agent/main.ts`

This is an experiment behind the flag; it must not change behavior when the flag is `none` or `openai`.

- [ ] **Step 1: Install and inspect the package**

Run: `npm i @livekit/noise-cancellation-node` then
`node -e "console.log(Object.keys(require('@livekit/noise-cancellation-node')))"`.
Note the exported name for the telephony filter (expected `TelephonyBackgroundVoiceCancellation`). If the package fails to install or has no telephony export, STOP and report BLOCKED with the output.

- [ ] **Step 2: Wire it for SIP callers only**

In `main.ts` add `import * as noiseCancellation from '@livekit/noise-cancellation-node';` and change the `session.start` call to:

```ts
    await session.start({
      agent: assistant,
      room: ctx.room,
      ...(isSip && env.PHONE_AUDIO_CLEANUP === 'bvc'
        ? { inputOptions: { noiseCancellation: noiseCancellation.TelephonyBackgroundVoiceCancellation() } }
        : {}),
    });
```
(Use the actual export name from Step 1 and whatever call shape its type requires; the `RoomInputOptions.noiseCancellation` type is `NoiseCancellationOptions | FrameProcessor<AudioFrame>`.)

- [ ] **Step 3: Typecheck and test**

Run: `npm run typecheck && npm test` — green.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/agent/main.ts
git commit -m "feat: optional LiveKit telephony noise cancellation for phone calls" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task A4: Greeting diagnostics

**Files:** Modify `src/agent/main.ts`

- [ ] **Step 1: Log message ids so duplicates can be told apart from repeated lines**

In the `ConversationItemAdded` handler, change the transcript log to include the item id and a per-call counter:

```ts
        callLog.info({ role: item.role, text, itemId: item.id, n: transcript.length }, 'transcript');
```
(`item.id` exists on conversation items; if typecheck says otherwise, log `n` only.)

- [ ] **Step 2: Typecheck, test, commit**

Run: `npm run typecheck && npm test`, then
```bash
git add src/agent/main.ts
git commit -m "chore: log item id and index in transcript lines for greeting diagnosis" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
The controller analyzes the next phone call: if two assistant greeting items with different ids appear before the caller speaks, `generateReply` raced the model's automatic response, and the fix (decided then) is to await `session.generateReply` only when no assistant item exists yet.

---

## PART B + C: Live events and dashboard

### Task B1: `ADMIN_TOKEN`

**Files:** Modify `src/config/env.ts`, `.env.example`; local-only `.env`

- [ ] **Step 1:** In `src/config/env.ts` add `ADMIN_TOKEN: z.string().min(16),` after `PHONE_HASH_KEY`. Append `ADMIN_TOKEN=` to `.env.example`.
- [ ] **Step 2:** Generate it into the real `.env` without printing it:
```bash
grep -q '^ADMIN_TOKEN=' .env || printf 'ADMIN_TOKEN=%s\n' "$(openssl rand -hex 16)" >> .env
node --env-file=.env -e 'console.log("len", process.env.ADMIN_TOKEN?.length)'
```
Expected `len 32`. Do not `cat` `.env`. Make sure `.env` ends with a newline before appending and has no stray non-`KEY=value` lines (an earlier stray line merged with the next key).
- [ ] **Step 3:** `npm run typecheck && npm test` green. Commit `src/config/env.ts .env.example` with message `feat: require ADMIN_TOKEN`.

---

### Task B2: `users.phone_last4`

**Files:** Modify `src/memory/phone.ts`, `src/memory/phone.test.ts`, `src/memory/schema.ts`, `src/memory/types.ts`, `src/memory/memory-repository.ts`, `src/memory/memory-repository.test.ts`, `src/memory/caller-identity.ts`, `src/memory/caller-identity.test.ts`; generate `drizzle/0003_*`; fix fakes.

- [ ] **Step 1: Tests first**

In `src/memory/phone.test.ts` add (and import `lastFour`):
```ts
describe('lastFour', () => {
  it('returns the last four digits of a normalized number', () => {
    expect(lastFour('+972501234567')).toBe('4567');
  });
});
```
In `src/memory/memory-repository.test.ts` add:
```ts
  it('stores last4 on create and fills it for an existing user that lacks it', async () => {
    const id = await repo.findOrCreateUserByPhoneHash('f'.repeat(64));
    expect((await repo.loadMemory(id)).user.phoneLast4).toBeNull();
    await repo.findOrCreateUserByPhoneHash('f'.repeat(64), '4567');
    expect((await repo.loadMemory(id)).user.phoneLast4).toBe('4567');
    await repo.findOrCreateUserByPhoneHash('f'.repeat(64), '9999');
    expect((await repo.loadMemory(id)).user.phoneLast4).toBe('4567');
  });
```
In `src/memory/caller-identity.test.ts` change the SIP-number test's expectation to
`expect(repo.findOrCreateUserByPhoneHash).toHaveBeenCalledWith(hashPhone('+972501234567', KEY), '4567');`

- [ ] **Step 2: Run to verify failure**: `npx vitest run src/memory` (expect failures).

- [ ] **Step 3: Implement**
- `phone.ts`: `export const lastFour = (e164: string): string => e164.slice(-4);`
- `schema.ts` `users`: after `phoneHash` add `phoneLast4: text('phone_last4'),`
- Generate: `npx drizzle-kit generate --name phone_last4`; confirm `drizzle/0003_phone_last4.sql` only adds the column.
- `types.ts`: change the method to `findOrCreateUserByPhoneHash(phoneHash: string, last4?: string): Promise<string>;`
- `memory-repository.ts` replace the method with:
```ts
  async findOrCreateUserByPhoneHash(phoneHash: string, last4?: string): Promise<string> {
    await this.db
      .insert(users)
      .values({ id: randomUUID(), phoneHash, phoneLast4: last4 })
      .onConflictDoNothing({ target: users.phoneHash });
    if (last4) {
      await this.db
        .update(users)
        .set({ phoneLast4: last4 })
        .where(and(eq(users.phoneHash, phoneHash), isNull(users.phoneLast4)));
    }
    const [row] = await this.db.select({ id: users.id }).from(users).where(eq(users.phoneHash, phoneHash));
    if (!row) throw new Error('failed to resolve user for phone hash');
    return row.id;
  }
```
Import `and, isNull` from `drizzle-orm` (add to the existing import line).
- `caller-identity.ts`: import `lastFour`, and call `repo.findOrCreateUserByPhoneHash(hashPhone(phone, hashKey), lastFour(phone))`.
- Add `phoneLast4: null,` to the user literals in tests that construct a user row (`src/agent/instructions.test.ts`, `src/memory/memory-formatter.test.ts`, `src/memory/summarizer.test.ts`, `src/agent/phone-profile.test.ts`) so typecheck passes.

- [ ] **Step 4:** `npm test && npm run typecheck` green.
- [ ] **Step 5:** Commit all of it: `feat: store last 4 digits of the caller number for dashboard labels`.

---

### Task B3: Repository: `listUsers`, `findMemory`, `deleteUser`

**Files:** Modify `src/memory/types.ts`, `src/memory/memory-repository.ts`, `src/memory/memory-repository.test.ts`, fakes in `src/agent/tools/memory-tools.test.ts` and `src/memory/summarizer.test.ts`.

- [ ] **Step 1: Types.** In `src/memory/types.ts` add:
```ts
export interface UserListItem {
  id: string;
  firstName: string | null;
  phoneLast4: string | null;
  lastCallAt: Date | null;
  callCount: number;
  deceasedCount: number;
}

export interface ListUsersParams {
  q?: string;
  limit?: number;
}
```
and to `MemoryRepository`:
```ts
  listUsers(params?: ListUsersParams): Promise<UserListItem[]>;
  /** Read-only: returns null for an unknown user and creates nothing. Includes all call summaries. */
  findMemory(userId: string): Promise<UserMemory | null>;
  /** Deletes the user and everything cascaded from them; returns false if there was no such user. */
  deleteUser(userId: string): Promise<boolean>;
```

- [ ] **Step 2: Write failing tests** in `memory-repository.test.ts`:
```ts
  it('listUsers searches by first name, last 4 digits and deceased name, newest call first', async () => {
    const a = await repo.findOrCreateUserByPhoneHash('1'.repeat(64), '1111');
    const b = await repo.findOrCreateUserByPhoneHash('2'.repeat(64), '2222');
    await repo.updateUser(a, { firstName: 'דניאל' });
    await repo.upsertDeceased(b, { name: 'יצחק' });
    expect((await repo.listUsers()).map((u) => u.id).sort()).toEqual([a, b].sort());
    expect((await repo.listUsers({ q: 'דני' })).map((u) => u.id)).toEqual([a]);
    expect((await repo.listUsers({ q: '2222' })).map((u) => u.id)).toEqual([b]);
    expect((await repo.listUsers({ q: 'יצח' })).map((u) => u.id)).toEqual([b]);
  });

  it('listUsers treats % and _ in the search as plain characters', async () => {
    const a = await repo.findOrCreateUserByPhoneHash('3'.repeat(64), '3333');
    await repo.updateUser(a, { firstName: 'דניאל' });
    expect(await repo.listUsers({ q: '%' })).toEqual([]);
    expect(await repo.listUsers({ q: '_' })).toEqual([]);
  });

  it('listUsers reports call and deceased counts', async () => {
    const a = await repo.findOrCreateUserByPhoneHash('4'.repeat(64), '4444');
    await repo.upsertDeceased(a, { name: 'דוד' });
    await repo.saveCallSummary(a, { startedAt: new Date(), endedAt: new Date(), summary: 's', openThreads: [] });
    const [row] = await repo.listUsers({ q: '4444' });
    expect(row).toMatchObject({ callCount: 1, deceasedCount: 1 });
    expect(row?.lastCallAt).toBeInstanceOf(Date);
  });

  it('findMemory returns null for an unknown user and does not create it', async () => {
    const unknown = '99999999-9999-4999-8999-999999999999';
    expect(await repo.findMemory(unknown)).toBeNull();
    expect(await repo.findMemory(unknown)).toBeNull();
    expect((await repo.listUsers()).some((u) => u.id === unknown)).toBe(false);
  });

  it('findMemory returns all call summaries, newest first', async () => {
    const a = await repo.findOrCreateUserByPhoneHash('5'.repeat(64), '5555');
    for (let i = 0; i < 5; i++) {
      await repo.saveCallSummary(a, { startedAt: new Date(2026, 0, i + 1), endedAt: new Date(2026, 0, i + 1), summary: `s${i}`, openThreads: [] });
    }
    const memory = await repo.findMemory(a);
    expect(memory?.recentSummaries).toHaveLength(5);
    expect(memory?.recentSummaries[0]?.summary).toBe('s4');
  });

  it('deleteUser removes the user with their data and reports whether it existed', async () => {
    const a = await repo.findOrCreateUserByPhoneHash('6'.repeat(64), '6666');
    await repo.upsertDeceased(a, { name: 'דוד' });
    expect(await repo.deleteUser(a)).toBe(true);
    expect(await repo.findMemory(a)).toBeNull();
    expect(await repo.deleteUser(a)).toBe(false);
  });
```
Run `npx vitest run src/memory/memory-repository.test.ts`: expect FAIL.

- [ ] **Step 3: Implement** in `memory-repository.ts`. Refactor `loadMemory` so both methods share one private loader:

```ts
const MAX_LIST = 200;

/** Escapes LIKE wildcards so user search text is matched literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}
```
(place above the class; also export it for the unit test below)

Inside the class:
```ts
  async loadMemory(userId: string): Promise<UserMemory> {
    await this.ensureUser(userId);
    const memory = await this.readMemory(userId, RECENT_SUMMARIES);
    if (!memory) throw new Error(`User ${userId} not found`);
    return memory;
  }

  async findMemory(userId: string): Promise<UserMemory | null> {
    return this.readMemory(userId);
  }

  async deleteUser(userId: string): Promise<boolean> {
    const rows = await this.db.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
    return rows.length > 0;
  }

  async listUsers({ q = '', limit = 50 }: ListUsersParams = {}): Promise<UserListItem[]> {
    const term = q.trim();
    const pattern = `%${escapeLike(term)}%`;
    const capped = Math.min(Math.max(limit, 1), MAX_LIST);
    const result = await this.db.execute(sql`
      select u.id,
             u.first_name as "firstName",
             u.phone_last4 as "phoneLast4",
             (select max(c.ended_at) from call_summaries c where c.user_id = u.id) as "lastCallAt",
             (select count(*)::int from call_summaries c where c.user_id = u.id) as "callCount",
             (select count(*)::int from deceased d where d.user_id = u.id) as "deceasedCount"
      from users u
      where ${term} = ''
         or u.first_name ilike ${pattern} escape '\\'
         or u.phone_last4 = ${term}
         or exists (select 1 from deceased d where d.user_id = u.id and d.name ilike ${pattern} escape '\\')
      order by "lastCallAt" desc nulls last, u.created_at desc
      limit ${capped}
    `);
    return result.rows as unknown as UserListItem[];
  }

  private async readMemory(userId: string, summaryLimit?: number): Promise<UserMemory | null> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) return null;
    const dead = await this.db.select().from(deceased).where(eq(deceased.userId, userId)).orderBy(deceased.createdAt);
    const companion = await this.db
      .select()
      .from(companionPreferences)
      .where(eq(companionPreferences.userId, userId))
      .orderBy(companionPreferences.createdAt);
    const summariesQuery = this.db
      .select()
      .from(callSummaries)
      .where(eq(callSummaries.userId, userId))
      .orderBy(desc(callSummaries.startedAt));
    const recentSummaries = summaryLimit ? await summariesQuery.limit(summaryLimit) : await summariesQuery;
    return { user, deceased: dead, companion, recentSummaries };
  }
```
Import `UserListItem`, `ListUsersParams` types. The SQL escape character in the template literal must reach Postgres as a single backslash: in a JS template string `'\\'` produces `\`; keep it exactly as shown and verify with the `%`/`_` test.

- [ ] **Step 4: Unit test for `escapeLike`** (append to `memory-repository.test.ts` top-level, no DB needed):
```ts
import { escapeLike } from './memory-repository.js';
describe('escapeLike', () => {
  it('escapes backslash, percent and underscore', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });
});
```
- [ ] **Step 5: Fix fakes.** Run `npm run typecheck`; add `listUsers: vi.fn(), findMemory: vi.fn(), deleteUser: vi.fn(),` to the fake repos in `src/agent/tools/memory-tools.test.ts` and `src/memory/summarizer.test.ts`.
- [ ] **Step 6:** `npm test && npm run typecheck` green. Commit: `feat: user list, read-only memory lookup and delete in the repository`.

---

### Task B4: Agent events (`NOTIFY` and listener)

**Files:**
- Create: `src/events/agent-events.ts`, `src/events/agent-events.test.ts`
- Modify: `src/memory/test-support.ts`

- [ ] **Step 1:** In `src/memory/test-support.ts` change `const TEST_DATABASE_URL` to `export const TEST_DATABASE_URL`.

- [ ] **Step 2: Failing tests.** Create `src/events/agent-events.test.ts`:
```ts
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../memory/db.js';
import { TEST_DATABASE_URL } from '../memory/test-support.js';
import { AgentEventListener, notifyAgentEvent, parseAgentEvent, shrinkEvent, type AgentEvent } from './agent-events.js';

const event = (over: Partial<AgentEvent> = {}): AgentEvent => ({
  userId: '00000000-0000-4000-8000-000000000001',
  kind: 'memory',
  tool: 'remember_deceased',
  input: { name: 'דוד' },
  at: new Date().toISOString(),
  ...over,
});

describe('parseAgentEvent', () => {
  it('parses a valid payload and rejects garbage', () => {
    expect(parseAgentEvent(JSON.stringify(event()))?.tool).toBe('remember_deceased');
    expect(parseAgentEvent('not json')).toBeNull();
    expect(parseAgentEvent(JSON.stringify({ kind: 'memory' }))).toBeNull();
  });
});

describe('shrinkEvent', () => {
  it('keeps small events and replaces oversized inputs', () => {
    expect(shrinkEvent(event()).input).toEqual({ name: 'דוד' });
    const big = shrinkEvent(event({ input: { text: 'א'.repeat(20_000) } }));
    expect(big.input).toEqual({ truncated: true });
    expect(Buffer.byteLength(JSON.stringify(big))).toBeLessThan(8000);
  });
});

describe('notify -> listener round trip', () => {
  const { db, close } = createDb(TEST_DATABASE_URL);
  afterAll(async () => close());

  it('delivers a notified event to a subscriber', async () => {
    const listener = new AgentEventListener(TEST_DATABASE_URL);
    await listener.start();
    try {
      const received = new Promise<AgentEvent>((resolve) => listener.subscribe(resolve));
      await notifyAgentEvent(db, event({ kind: 'call_started', tool: undefined, input: undefined }));
      expect((await received).kind).toBe('call_started');
    } finally {
      await listener.stop();
    }
  });

  it('stops delivering after unsubscribe', async () => {
    const listener = new AgentEventListener(TEST_DATABASE_URL);
    await listener.start();
    try {
      const seen: AgentEvent[] = [];
      const off = listener.subscribe((e) => seen.push(e));
      off();
      await notifyAgentEvent(db, event());
      await new Promise((r) => setTimeout(r, 300));
      expect(seen).toHaveLength(0);
    } finally {
      await listener.stop();
    }
  });
});
```
Run `npx vitest run src/events` — expect FAIL (module missing).

- [ ] **Step 3: Implement `src/events/agent-events.ts`:**
```ts
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { z } from 'zod';
import type { Db } from '../memory/db.js';
import { createLogger } from '../logger.js';

const log = createLogger('agent-events');

export const AGENT_EVENTS_CHANNEL = 'agent_events';
const MAX_PAYLOAD_BYTES = 7500;
const RECONNECT_DELAY_MS = 1000;

const eventSchema = z.object({
  userId: z.string().min(1),
  kind: z.enum(['memory', 'call_started', 'call_ended']),
  tool: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  at: z.string(),
});
export type AgentEvent = z.infer<typeof eventSchema>;

export function parseAgentEvent(raw: string): AgentEvent | null {
  try {
    const result = eventSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Postgres limits NOTIFY payloads to 8000 bytes; drop the input when an event would not fit. */
export function shrinkEvent(event: AgentEvent): AgentEvent {
  if (Buffer.byteLength(JSON.stringify(event)) <= MAX_PAYLOAD_BYTES) return event;
  return { ...event, input: { truncated: true } };
}

export async function notifyAgentEvent(db: Db, event: AgentEvent): Promise<void> {
  const payload = JSON.stringify(shrinkEvent(event));
  await db.execute(sql`select pg_notify(${AGENT_EVENTS_CHANNEL}, ${payload})`);
}

export interface AgentEventSource {
  subscribe(handler: (event: AgentEvent) => void): () => void;
}

/** One dedicated connection that LISTENs for agent events and fans them out to subscribers. */
export class AgentEventListener implements AgentEventSource {
  private client: Client | null = null;
  private readonly handlers = new Set<(event: AgentEvent) => void>();
  private stopped = false;

  constructor(private readonly connectionString: string) {}

  subscribe(handler: (event: AgentEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const client = this.client;
    this.client = null;
    await client?.end().catch(() => {});
  }

  private async connect(): Promise<void> {
    const client = new Client({ connectionString: this.connectionString });
    client.on('notification', (msg) => {
      const event = msg.payload ? parseAgentEvent(msg.payload) : null;
      if (!event) return;
      for (const handler of this.handlers) {
        try {
          handler(event);
        } catch (err) {
          log.error({ err }, 'event handler failed');
        }
      }
    });
    client.on('error', (err) => {
      log.error({ err }, 'listener connection error');
      this.scheduleReconnect();
    });
    client.on('end', () => this.scheduleReconnect());
    await client.connect();
    await client.query(`LISTEN ${AGENT_EVENTS_CHANNEL}`);
    this.client = client;
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.client = null;
    setTimeout(() => {
      if (this.stopped) return;
      this.connect().catch((err) => {
        log.error({ err }, 'listener reconnect failed');
        this.scheduleReconnect();
      });
    }, RECONNECT_DELAY_MS);
  }
}
```
- [ ] **Step 4:** `npx vitest run src/events` PASS, then `npm test && npm run typecheck` green.
- [ ] **Step 5:** Commit `src/events src/memory/test-support.ts` as `feat: agent events over Postgres LISTEN/NOTIFY`.

---

### Task B5: Agent emits events

**Files:** Modify `src/agent/main.ts`

- [ ] **Step 1:** Import `import { notifyAgentEvent } from '../events/agent-events.js';`.
- [ ] **Step 2:** Add a helper after `callLog`/`db` exist:
```ts
    // Dashboard feed; never allowed to affect the call.
    const emit = (event: { kind: 'memory' | 'call_started' | 'call_ended'; tool?: string; input?: Record<string, unknown> }) => {
      if (!userId) return;
      notifyAgentEvent(db, { userId, at: new Date().toISOString(), ...event }).catch((err) =>
        callLog.error({ err }, 'failed to notify dashboard'),
      );
    };
```
Place it after `userId` is resolved. Because `userId` is a `const` of type `string | null`, the early return handles anonymous calls.
- [ ] **Step 3:** In `publishEvent`, after the existing data-channel publish, add `emit({ kind: 'memory', tool: event.tool, input: event.input });`.
- [ ] **Step 4:** After the `memory loaded` section and before `session.start`, add `emit({ kind: 'call_started' });`.
- [ ] **Step 5:** In the shutdown callback, `close()` runs in the `finally`, so the end event must be sent (and awaited) before it. Add a small local function next to `emit`:
```ts
    const emitCallEnded = async () => {
      if (!userId) return;
      await notifyAgentEvent(db, { userId, kind: 'call_ended', at: new Date().toISOString() }).catch((err) =>
        callLog.error({ err }, 'failed to notify call end'),
      );
    };
```
Call `await emitCallEnded();` (a) inside the `try`, right after the `if (userId) { await Promise.race([...]) }` block, so the dashboard refreshes after the summary exists; and (b) as the first line of the `catch` block, so the dashboard still clears "on call now" when saving the summary fails or times out.
- [ ] **Step 6:** `npm run typecheck && npm test` green. Commit `src/agent/main.ts`: `feat: agent emits live events and call start/end to the dashboard feed`.

---

### Task B6: Admin API on the server

**Files:**
- Create: `src/server/auth.ts`, `src/server/auth.test.ts`, `src/server/routes/admin.ts`, `src/server/routes/admin.test.ts`
- Modify: `src/server/app.ts`, `src/server/main.ts`

- [ ] **Step 1: Auth tests.** `src/server/auth.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isValidAdminToken } from './auth.js';

const TOKEN = 'a'.repeat(32);

describe('isValidAdminToken', () => {
  it('accepts the exact bearer token', () => {
    expect(isValidAdminToken(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });
  it('rejects missing, wrong scheme, wrong token and different length', () => {
    expect(isValidAdminToken(undefined, TOKEN)).toBe(false);
    expect(isValidAdminToken(TOKEN, TOKEN)).toBe(false);
    expect(isValidAdminToken(`Bearer ${'b'.repeat(32)}`, TOKEN)).toBe(false);
    expect(isValidAdminToken('Bearer short', TOKEN)).toBe(false);
  });
});
```
- [ ] **Step 2: `src/server/auth.ts`:**
```ts
import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Constant-time check of an `Authorization: Bearer <token>` header. */
export function isValidAdminToken(header: string | undefined, expected: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  if (!match?.[1]) return false;
  return timingSafeEqual(digest(match[1]), digest(expected));
}
```
- [ ] **Step 3: Route tests.** `src/server/routes/admin.test.ts`:
```ts
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AgentEventSource } from '../../events/agent-events.js';
import type { MemoryRepository } from '../../memory/types.js';
import { adminRoutes } from './admin.js';

const TOKEN = 't'.repeat(32);
const auth = { authorization: `Bearer ${TOKEN}` };
const UID = '11111111-1111-4111-8111-111111111111';

const build = (repo: Partial<MemoryRepository>) => {
  const app = Fastify();
  const events: AgentEventSource = { subscribe: () => () => {} };
  app.register(adminRoutes({ repo: repo as MemoryRepository, events, token: TOKEN, demoUserId: UID }));
  return app;
};

describe('admin routes', () => {
  it('rejects requests without a valid token', async () => {
    const app = build({ listUsers: vi.fn() });
    expect((await app.inject({ method: 'GET', url: '/api/users' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/users', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
  });

  it('lists users and flags the demo user', async () => {
    const listUsers = vi.fn().mockResolvedValue([
      { id: UID, firstName: 'דניאל', phoneLast4: null, lastCallAt: null, callCount: 0, deceasedCount: 0 },
    ]);
    const res = await build({ listUsers }).inject({ method: 'GET', url: '/api/users?q=%D7%93&limit=10', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(listUsers).toHaveBeenCalledWith({ q: 'ד', limit: 10 });
    expect(res.json()[0]).toMatchObject({ id: UID, isDemo: true });
  });

  it('returns 400 for a malformed id and 404 for an unknown user', async () => {
    const app = build({ findMemory: vi.fn().mockResolvedValue(null) });
    expect((await app.inject({ method: 'GET', url: '/api/users/not-a-uuid/memory', headers: auth })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/api/users/${UID}/memory`, headers: auth })).statusCode).toBe(404);
  });

  it('deletes a user (204) and reports 404 when it did not exist', async () => {
    const deleteUser = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const app = build({ deleteUser });
    expect((await app.inject({ method: 'DELETE', url: `/api/users/${UID}`, headers: auth })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/users/${UID}`, headers: auth })).statusCode).toBe(404);
  });
});
```
Run `npx vitest run src/server` — expect FAIL.

- [ ] **Step 4: `src/server/routes/admin.ts`:**
```ts
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AgentEventSource } from '../../events/agent-events.js';
import type { MemoryRepository } from '../../memory/types.js';
import { isValidAdminToken } from '../auth.js';

const HEARTBEAT_MS = 25_000;

const listQuery = z.object({
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const idParams = z.object({ id: z.string().uuid() });

export interface AdminRoutesOptions {
  repo: MemoryRepository;
  events: AgentEventSource;
  token: string;
  demoUserId: string;
}

/** Everything under /api here requires the admin token. */
export const adminRoutes =
  ({ repo, events, token, demoUserId }: AdminRoutesOptions): FastifyPluginAsync =>
  async (app) => {
    app.addHook('onRequest', async (req, reply) => {
      if (!isValidAdminToken(req.headers.authorization, token)) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
    });

    app.get('/api/users', async (req, reply) => {
      const query = listQuery.safeParse(req.query);
      if (!query.success) return reply.code(400).send({ error: 'bad query' });
      const users = await repo.listUsers(query.data);
      return users.map((u) => ({ ...u, isDemo: u.id === demoUserId }));
    });

    app.get('/api/users/:id/memory', async (req, reply) => {
      const params = idParams.safeParse(req.params);
      if (!params.success) return reply.code(400).send({ error: 'bad id' });
      const memory = await repo.findMemory(params.data.id);
      return memory ?? reply.code(404).send({ error: 'not found' });
    });

    app.delete('/api/users/:id', async (req, reply) => {
      const params = idParams.safeParse(req.params);
      if (!params.success) return reply.code(400).send({ error: 'bad id' });
      const removed = await repo.deleteUser(params.data.id);
      return reply.code(removed ? 204 : 404).send();
    });

    app.get('/api/events', (req, reply) => {
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      const unsubscribe = events.subscribe((event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
      const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
      req.raw.on('close', () => {
        clearInterval(beat);
        unsubscribe();
      });
    });
  };
```
- [ ] **Step 5: Wire it.** In `src/server/app.ts`: import `AgentEventListener`, `adminRoutes`; after creating `db`:
```ts
  const repo = new DrizzleMemoryRepository(db);
  const events = new AgentEventListener(env.DATABASE_URL);
  await events.start();
  app.addHook('onClose', async () => events.stop());
```
Replace the existing `memoryRoutes(...)` registration with `await app.register(adminRoutes({ repo, events, token: env.ADMIN_TOKEN, demoUserId: DEMO_USER_ID }));`. Remove the `memoryRoutes` import. Delete `src/server/routes/memory.ts` (the dashboard now uses `/api/users/:id/...`; the demo user is just one of the users). `/api/token` and `/health` stay open.
- [ ] **Step 6:** `npm test && npm run typecheck` green. Commit: `feat: token-protected admin API with live event stream`.

---

### Task B7: Front end

**Files:**
- Replace: `public/index.html`
- Create: `public/js/main.js`, `public/js/api.js`, `public/js/call.js`, `public/js/dashboard.js`
- Delete: `public/client.js`

No automated tests (browser UI); verify by typecheck of the rest, loading the page, and Task B8. All stored text must be inserted with `textContent`, never `innerHTML`.

- [ ] **Step 1: `public/js/api.js`**
```js
const KEY = 'adminToken';

export const getToken = () => {
  try { return sessionStorage.getItem(KEY) ?? ''; } catch { return ''; }
};
export const setToken = (value) => {
  try { value ? sessionStorage.setItem(KEY, value) : sessionStorage.removeItem(KEY); } catch { /* ignore */ }
};

export class Unauthorized extends Error {}

export async function apiFetch(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { ...options.headers, authorization: `Bearer ${getToken()}` } });
  if (res.status === 401) {
    setToken('');
    throw new Unauthorized();
  }
  return res;
}

/** Reads the server-sent-event stream with fetch so the Authorization header can be sent. */
export async function streamEvents(onEvent, signal) {
  const res = await apiFetch('/api/events', { signal });
  if (!res.ok || !res.body) throw new Error(`events stream failed: ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try { onEvent(JSON.parse(line.slice(6))); } catch (err) { console.error('bad event', err); }
    }
  }
}
```
- [ ] **Step 2: `public/js/call.js`** (the web call, unchanged behavior, no memory handling)
```js
import { Room, RoomEvent, Track } from 'https://cdn.jsdelivr.net/npm/livekit-client@2.15.4/+esm';

const $ = (id) => document.getElementById(id);

export function initCall() {
  const button = $('toggle');
  const status = $('status');
  const muteButton = $('mute');
  let room = null;
  let muted = false;

  const setStatus = (text) => { status.textContent = text; };

  function reset(message = 'מנותק') {
    room = null;
    muteButton.hidden = true;
    button.textContent = 'התחל שיחה';
    setStatus(message);
  }

  async function setMuted(value) {
    await room?.localParticipant.setMicrophoneEnabled(!value);
    muted = value;
    muteButton.textContent = muted ? 'בטל השתקה' : 'השתק מיקרופון';
    setStatus(muted ? 'מחובר - המיקרופון מושתק' : 'מחובר - אפשר לדבר');
  }

  async function connect() {
    button.disabled = true;
    setStatus('מתחבר...');
    try {
      const res = await fetch('/api/token', { method: 'POST' });
      if (!res.ok) throw new Error(`token request failed: ${res.status}`);
      const { token, url } = await res.json();
      room = new Room();
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) document.body.appendChild(track.attach());
      });
      room.on(RoomEvent.Disconnected, () => reset());
      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      button.textContent = 'סיים שיחה';
      await setMuted(false);
      muteButton.hidden = false;
    } catch (err) {
      console.error(err);
      await room?.disconnect();
      reset('שגיאת חיבור');
    } finally {
      button.disabled = false;
    }
  }

  muteButton.addEventListener('click', () => setMuted(!muted).catch(console.error));
  button.addEventListener('click', () => (room ? room.disconnect() : connect()));
}
```
- [ ] **Step 3: `public/js/dashboard.js`**
```js
import { apiFetch, streamEvents, Unauthorized } from './api.js';

const $ = (id) => document.getElementById(id);

const GENDERS = { male: 'זכר', female: 'נקבה', other: 'אחר' };
const CATEGORIES = { likes: 'אוהב/ת', style: 'סגנון', address: 'איך לפנות', avoid: 'להימנע', smiles: 'משמח/מצחיק', other: 'אחר' };
const fmt = (v) => (v ? new Date(v).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '');

const state = { users: [], selectedId: null, live: new Set(), events: [], scope: 'selected', query: '' };

export const userLabel = (u) => {
  const base = u.isDemo ? 'Demo (web)' : u.firstName || 'מתקשר/ת לא מזוהה';
  return u.phoneLast4 ? `${base} ••••${u.phoneLast4}` : base;
};

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/** Plain-text table: stored text is model-generated and must never be parsed as HTML. */
function table(headers, rows) {
  if (!rows.length) return el('p', { className: 'empty', textContent: 'אין מידע שמור' });
  const t = el('table');
  const head = t.createTHead().insertRow();
  for (const h of headers) head.append(el('th', { textContent: h }));
  const body = t.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const cell of row) tr.insertCell().textContent = cell ?? '';
  }
  return t;
}

function section(name, title, content) {
  const d = el('details', { className: 'sec' }, el('summary', { textContent: title }), content);
  let open = true;
  try { open = localStorage.getItem(`sec:${name}`) !== 'closed'; } catch { /* ignore */ }
  d.open = open;
  d.addEventListener('toggle', () => {
    try { localStorage.setItem(`sec:${name}`, d.open ? 'open' : 'closed'); } catch { /* ignore */ }
  });
  return d;
}

// ---------- user list ----------

function renderList() {
  const list = $('users');
  list.replaceChildren();
  if (!state.users.length) {
    list.append(el('li', { className: 'empty', textContent: 'לא נמצאו משתמשים' }));
    return;
  }
  for (const u of state.users) {
    const li = el('li', { className: u.id === state.selectedId ? 'selected' : '' });
    const btn = el('button', { type: 'button' },
      el('span', { className: 'name', textContent: userLabel(u) }),
      el('span', { className: 'meta', textContent: u.lastCallAt ? `שיחה אחרונה: ${fmt(u.lastCallAt)}` : 'אין שיחות' }));
    if (state.live.has(u.id)) btn.append(el('span', { className: 'badge', textContent: 'בשיחה עכשיו' }));
    btn.addEventListener('click', () => selectUser(u.id));
    li.append(btn);
    list.append(li);
  }
}

export async function loadUsers() {
  const res = await apiFetch(`/api/users?q=${encodeURIComponent(state.query)}`);
  if (!res.ok) throw new Error(`users failed: ${res.status}`);
  state.users = await res.json();
  if (!state.selectedId && state.users[0]) state.selectedId = state.users[0].id;
  renderList();
  if (state.selectedId) await showUser(state.selectedId);
}

// ---------- selected user ----------

async function selectUser(id) {
  state.selectedId = id;
  renderList();
  renderEvents();
  await showUser(id);
}

async function showUser(id) {
  const pane = $('detail');
  const res = await apiFetch(`/api/users/${id}/memory`);
  if (res.status === 404) {
    state.selectedId = null;
    pane.replaceChildren(el('p', { className: 'empty', textContent: 'המשתמש לא נמצא' }));
    return;
  }
  if (!res.ok) throw new Error(`memory failed: ${res.status}`);
  const { user, deceased, companion, recentSummaries } = await res.json();
  const summary = state.users.find((u) => u.id === id);
  const label = summary ? userLabel(summary) : user.firstName || id;

  const hasProfile = user.firstName || user.addressAs || user.gender || user.notes;
  pane.replaceChildren(
    el('h2', { textContent: label }),
    section('profile', 'פרופיל', table(['שם', 'פונים אליו כ', 'מגדר', 'הערות'],
      hasProfile ? [[user.firstName, user.addressAs, GENDERS[user.gender], user.notes]] : [])),
    section('deceased', 'יקירים שנפטרו', table(['שם', 'קרבה', 'תאריך פטירה', 'נסיבות', 'הערות'],
      deceased.map((d) => [d.name, d.relationship, d.dateOfDeath, d.circumstances, d.notes]))),
    section('companion', 'העדפות למצב חברותי', table(['קטגוריה', 'העדפה', 'נשמר ב'],
      companion.map((c) => [CATEGORIES[c.category] ?? c.category, c.note, fmt(c.createdAt)]))),
    section('calls', `סיכומי שיחות (${recentSummaries.length})`, table(['תאריך', 'סיכום', 'מצב רוח', 'נושאים פתוחים'],
      recentSummaries.map((s) => [fmt(s.startedAt), s.summary, s.mood, s.openThreads.join('\n')]))),
    deleteControl(id, label),
  );
}

function deleteControl(id, label) {
  const input = el('input', { type: 'text', placeholder: `הקלד/י "${label}" לאישור` });
  const confirm = el('button', { type: 'button', className: 'danger', textContent: 'מחק משתמש', disabled: true });
  input.addEventListener('input', () => { confirm.disabled = input.value.trim() !== label; });
  confirm.addEventListener('click', async () => {
    const res = await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) return;
    state.selectedId = null;
    await loadUsers();
  });
  return el('div', { className: 'delete' }, el('p', { className: 'muted', textContent: 'מחיקה סופית של המשתמש ושל כל המידע עליו' }), input, confirm);
}

// ---------- live feed ----------

function renderEvents() {
  const list = $('events');
  list.replaceChildren();
  const shown = state.events.filter((e) => state.scope === 'all' || e.userId === state.selectedId);
  if (!shown.length) {
    list.append(el('li', { className: 'empty', textContent: 'אין אירועים עדיין' }));
    return;
  }
  for (const e of shown) {
    const who = state.users.find((u) => u.id === e.userId);
    const what = e.kind === 'memory' ? e.tool : e.kind === 'call_started' ? 'השיחה התחילה' : 'השיחה הסתיימה';
    list.append(el('li', {},
      el('time', { textContent: fmt(e.at) }),
      el('code', { textContent: what }),
      ` ${who ? userLabel(who) : ''} ${e.input ? JSON.stringify(e.input) : ''}`));
  }
}

async function onEvent(event) {
  state.events.unshift(event);
  state.events.length = Math.min(state.events.length, 100);
  if (event.kind === 'call_started') state.live.add(event.userId);
  if (event.kind === 'call_ended') state.live.delete(event.userId);
  const known = state.users.some((u) => u.id === event.userId);
  if (!known || event.kind !== 'memory') await loadUsers().catch(console.error);
  else if (event.userId === state.selectedId) await showUser(event.userId).catch(console.error);
  renderList();
  renderEvents();
}

export async function startDashboard(onAuthLost) {
  let timer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = e.target.value.trim();
      loadUsers().catch((err) => (err instanceof Unauthorized ? onAuthLost() : console.error(err)));
    }, 250);
  });
  for (const radio of document.querySelectorAll('input[name="scope"]')) {
    radio.addEventListener('change', () => { state.scope = radio.value; renderEvents(); });
  }
  await loadUsers();
  renderEvents();
  // Reconnect with a short delay if the stream drops; stop only when the token is rejected.
  for (;;) {
    try {
      await streamEvents(onEvent);
    } catch (err) {
      if (err instanceof Unauthorized) return onAuthLost();
      console.error('event stream error', err);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
```
- [ ] **Step 4: `public/js/main.js`**
```js
import { getToken, setToken } from './api.js';
import { initCall } from './call.js';
import { startDashboard } from './dashboard.js';

const $ = (id) => document.getElementById(id);

function showGate(message = '') {
  $('gate').hidden = false;
  $('gate-error').textContent = message;
  $('app').hidden = true;
}

function start() {
  $('gate').hidden = true;
  $('app').hidden = false;
  startDashboard(() => showGate('הטוקן לא תקין')).catch((err) => {
    console.error(err);
    showGate('הטוקן לא תקין');
  });
}

$('gate-form').addEventListener('submit', (e) => {
  e.preventDefault();
  setToken($('gate-token').value.trim());
  $('gate-token').value = '';
  start();
});

initCall();
getToken() ? start() : showGate();
```
Note: a second `start()` after a re-entered token would start a second event loop; guard with a module-level `let started = false` inside `startDashboard` is NOT used because the old loop exits on 401. Keep as written.

- [ ] **Step 5: `public/index.html`** (replace entirely)
```html
<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>סוכן קולי</title>
  <style>
    :root { color-scheme: dark; --bg:#111; --panel:#1b1b1b; --line:#333; --muted:#9a9a9a; --accent:#7cc4ff; --danger:#ff6b6b; --ok:#5ddf9a; }
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 0; background: var(--bg); color: #eee; }
    header { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; padding: 1rem 16px; max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 1.3rem; margin: 0; flex: 1; }
    h2 { font-size: 1.1rem; margin: 0 0 .75rem; color: var(--accent); }
    button { font: inherit; padding: .5rem 1.2rem; border: 0; border-radius: 999px; cursor: pointer; }
    button:disabled { opacity: .5; cursor: default; }
    button.danger { background: transparent; color: var(--danger); border: 1px solid var(--danger); }
    input[type=text], input[type=search], input[type=password] { font: inherit; padding: .5rem .75rem; border-radius: 8px; border: 1px solid var(--line); background: #0d0d0d; color: #eee; width: 100%; }
    #status, .muted, .meta { color: var(--muted); }
    .layout { display: grid; grid-template-columns: minmax(220px, 320px) 1fr; gap: 1rem; max-width: 1200px; margin: 0 auto; padding: 0 16px 2rem; }
    @media (max-width: 720px) { .layout { grid-template-columns: 1fr; } }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 1rem; min-width: 0; }
    #users { list-style: none; margin: .75rem 0 0; padding: 0; max-height: 60vh; overflow-y: auto; }
    #users li button { display: flex; flex-direction: column; gap: .15rem; width: 100%; text-align: start; background: transparent; color: inherit; border-radius: 8px; padding: .6rem; }
    #users li.selected button, #users li button:hover { background: #262626; }
    .name { font-weight: 600; }
    .badge { align-self: flex-start; font-size: .75rem; color: #04210f; background: var(--ok); border-radius: 999px; padding: .05rem .5rem; }
    details.sec { border-top: 1px solid var(--line); padding: .5rem 0; }
    details.sec summary { cursor: pointer; color: var(--accent); padding: .3rem 0; }
    .empty { color: var(--muted); font-style: italic; }
    table { width: 100%; border-collapse: collapse; font-size: .9rem; display: block; overflow-x: auto; }
    th, td { text-align: start; padding: .4rem .5rem; border-bottom: 1px solid var(--line); vertical-align: top; white-space: pre-wrap; }
    th { color: var(--muted); font-weight: 500; }
    .delete { margin-top: 1rem; display: grid; gap: .5rem; max-width: 420px; }
    #events { list-style: none; margin: .5rem 0 0; padding: 0; max-height: 220px; overflow-y: auto; }
    #events li { padding: .4rem 0; border-bottom: 1px solid var(--line); font-size: .9rem; }
    #events time { color: var(--muted); margin-inline-end: .5rem; }
    #events code { color: var(--accent); direction: ltr; unicode-bidi: embed; }
    .scope { display: flex; gap: 1rem; color: var(--muted); font-size: .9rem; }
    #gate { max-width: 360px; margin: 20vh auto; padding: 0 16px; display: grid; gap: .75rem; }
    #gate-error { color: var(--danger); min-height: 1.2em; }
  </style>
</head>
<body>
  <div id="gate" hidden>
    <h1>כניסה ללוח הבקרה</h1>
    <form id="gate-form" style="display:grid;gap:.75rem">
      <input id="gate-token" type="password" placeholder="טוקן ניהול" autocomplete="off" required />
      <button type="submit">כניסה</button>
    </form>
    <div id="gate-error"></div>
  </div>

  <div id="app" hidden>
    <header>
      <h1>סוכן קולי בעברית</h1>
      <span id="status">מנותק</span>
      <button id="mute" hidden>השתק מיקרופון</button>
      <button id="toggle">התחל שיחה</button>
    </header>
    <div class="layout">
      <aside class="panel">
        <h2>משתמשים</h2>
        <input id="search" type="search" placeholder="חיפוש לפי שם, 4 ספרות או שם נפטר" />
        <ul id="users"></ul>
      </aside>
      <main style="display:grid;gap:1rem;min-width:0">
        <section class="panel" id="detail"><p class="empty">בחר/י משתמש</p></section>
        <section class="panel">
          <h2>אירועים בזמן אמת</h2>
          <div class="scope">
            <label><input type="radio" name="scope" value="selected" checked /> המשתמש שנבחר</label>
            <label><input type="radio" name="scope" value="all" /> כולם</label>
          </div>
          <ul id="events"><li class="empty">אין אירועים עדיין</li></ul>
        </section>
      </main>
    </div>
  </div>
  <script type="module" src="/js/main.js"></script>
</body>
</html>
```
- [ ] **Step 6:** Delete `public/client.js` (`git rm public/client.js`). Run `npm run typecheck && npm test` (server and agent unaffected) and `node --check` each `public/js/*.js` file (`for f in public/js/*.js; do node --check "$f" || echo FAIL $f; done`; ES-module syntax with remote imports is fine for `--check`).
- [ ] **Step 7:** Commit `public`: `feat: searchable multi-user dashboard with live feed`.

---

### Task B8: Apply, restart and verify (controller + user)

**Files:** none

- [ ] **Step 1:** `npm run db:migrate` (adds `phone_last4`, nullable; no data changes).
- [ ] **Step 2:** Restart: `pkill -f "src/agent/main.ts"; pkill -f "src/server/main.ts"; sleep 2; (nohup npm run dev:agent > /tmp/agent.log 2>&1 &); (nohup npm run dev:server > /tmp/server.log 2>&1 &); sleep 9; curl -s -o /dev/null -w "web %{http_code}\n" http://localhost:3100` — expect `200`; check `/tmp/server.log` has no `Invalid environment configuration`.
- [ ] **Step 3:** Token check without printing it: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/api/users` expect `401`; with the header from `.env` (read inside the shell, not echoed) expect `200`.
- [ ] **Step 4 (user):** open http://localhost:3100, paste the admin token (the controller tells the user how to read it from `.env` themselves), check the user list, search and collapsing.
- [ ] **Step 5 (user):** call the number with the dashboard open: the caller shows "בשיחה עכשיו", memory events appear live, and the summary appears when the call ends.
- [ ] **Step 6 (user + controller):** phone quality script: call in, ask the same 10 questions (including "מה השם שלי?" and "איך קראו לנפטר?"), once per setting of `PHONE_AUDIO_CLEANUP` (`none`, `openai`, `bvc`; change in `.env`, restart the agent only with `pkill -f "src/agent/main.ts"`). Record transcribed-correctly and answered-correctly counts for each. Keep the best setting in `.env`.
- [ ] **Step 7:** Analyze duplicate-greeting evidence from the `itemId` logs (Task A4) and decide on a fix.
- [ ] **Step 8:** Report results to the user. Do not push to GitHub until the user asks.
