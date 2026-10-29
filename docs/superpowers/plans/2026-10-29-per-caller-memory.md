# Per-caller Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each phone caller gets their own Postgres memory, identified by a keyed hash of their phone number; the web client stays the demo user; hidden-number calls are anonymous and save nothing.

**Architecture:** A pure `phone.ts` (normalize + HMAC hash), a nullable unique `users.phone_hash` column with an atomic `findOrCreateUserByPhoneHash` repository method, and a `resolveUserId` function that maps the LiveKit participant to a `userId | null`. `main.ts` connects, waits for the participant, resolves the user, and runs in anonymous mode when the result is `null`. All existing memory code already takes a `userId`, so it is unchanged.

**Tech Stack:** TypeScript/Node, Drizzle ORM + drizzle-kit migrations, Postgres, Vitest, LiveKit Agents JS 1.9.2, zod, pino.

**Spec:** `docs/superpowers/specs/2026-10-29-per-caller-memory-design.md`

**Rules for every task:**
- Never print `.env` values or the phone number in logs, output or commits. Logs may show only the first 8 hex chars of a hash.
- Never run `DELETE /api/memory`, `clearMemory`, or anything destructive against the real database. Tests use the dedicated `podcusts_test` database (`createTestRepo`).
- Commit messages end with: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- Do not push to GitHub; the controller will ask the user.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/memory/phone.ts` | Create | `normalizePhone`, `hashPhone` (pure) |
| `src/memory/phone.test.ts` | Create | Unit tests for the above |
| `src/config/env.ts` | Modify | Add required `PHONE_HASH_KEY` |
| `.env.example` | Modify | Document `PHONE_HASH_KEY` |
| `src/memory/schema.ts` | Modify | Add `users.phoneHash` |
| `drizzle/0002_*.sql` + `drizzle/meta/*` | Generate | Migration |
| `src/memory/types.ts` | Modify | Add `findOrCreateUserByPhoneHash` to `MemoryRepository` |
| `src/memory/memory-repository.ts` | Modify | Implement it |
| `src/memory/memory-repository.test.ts` | Modify | Tests for it |
| `src/agent/tools/memory-tools.test.ts`, `src/memory/summarizer.test.ts` | Modify | Add the new method to fake repos if they are typed `MemoryRepository` |
| `src/memory/caller-identity.ts` | Create | `resolveUserId` |
| `src/memory/caller-identity.test.ts` | Create | Tests |
| `src/agent/main.ts` | Modify | Use `resolveUserId`, anonymous mode |

---

### Task 1: Phone normalisation and hashing

**Files:**
- Create: `src/memory/phone.ts`
- Test: `src/memory/phone.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/memory/phone.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hashPhone, normalizePhone } from './phone.js';

const KEY = 'k'.repeat(32);

describe('normalizePhone', () => {
  it('keeps a valid E.164 number', () => {
    expect(normalizePhone('+972501234567')).toBe('+972501234567');
  });

  it('strips spaces, dashes, dots and parentheses', () => {
    expect(normalizePhone('+972 (50) 123-4567')).toBe('+972501234567');
    expect(normalizePhone('+972.50.123.4567')).toBe('+972501234567');
  });

  it('converts a leading 00 to +', () => {
    expect(normalizePhone('00972501234567')).toBe('+972501234567');
  });

  it('returns null for missing, empty, local-format or malformed input', () => {
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('0501234567')).toBeNull();
    expect(normalizePhone('+12')).toBeNull();
    expect(normalizePhone('+97250abc4567')).toBeNull();
    expect(normalizePhone('+9725012345678901')).toBeNull();
    expect(normalizePhone('anonymous')).toBeNull();
  });
});

describe('hashPhone', () => {
  it('is stable for the same number and key', () => {
    expect(hashPhone('+972501234567', KEY)).toBe(hashPhone('+972501234567', KEY));
  });

  it('differs for different numbers and different keys', () => {
    expect(hashPhone('+972501234567', KEY)).not.toBe(hashPhone('+972501234568', KEY));
    expect(hashPhone('+972501234567', KEY)).not.toBe(hashPhone('+972501234567', 'z'.repeat(32)));
  });

  it('returns 64 hex chars that contain no part of the number', () => {
    const hash = hashPhone('+972501234567', KEY);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('972501234567');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/memory/phone.test.ts`
Expected: FAIL (cannot find module `./phone.js`).

- [ ] **Step 3: Write the implementation**

Create `src/memory/phone.ts`:

```ts
import { createHmac } from 'node:crypto';

const E164 = /^\+[1-9]\d{6,14}$/;

/** Returns the number in E.164 form, or null when it is missing or not a valid international number. */
export function normalizePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  let value = raw.replace(/[\s\-().]/g, '');
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  return E164.test(value) ? value : null;
}

/** Keyed hash used as the caller's identity; the raw number is never stored. */
export function hashPhone(e164: string, key: string): string {
  return createHmac('sha256', key).update(e164).digest('hex');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/memory/phone.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/memory/phone.ts src/memory/phone.test.ts
git commit -m "feat: phone normalization and keyed hashing" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `PHONE_HASH_KEY` configuration

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Modify (locally, never committed): `.env`

- [ ] **Step 1: Add the variable to the env schema**

In `src/config/env.ts`, add this line inside `z.object({ ... })` after `LIVEKIT_API_SECRET`:

```ts
  PHONE_HASH_KEY: z.string().min(32),
```

- [ ] **Step 2: Document it in `.env.example`**

Append a line to `.env.example`:

```
PHONE_HASH_KEY=
```

- [ ] **Step 3: Generate the key into the real `.env` without printing it**

Run (only if `.env` has no `PHONE_HASH_KEY` line yet):

```bash
grep -q '^PHONE_HASH_KEY=' .env || printf '\nPHONE_HASH_KEY=%s\n' "$(openssl rand -hex 32)" >> .env
grep -c '^PHONE_HASH_KEY=.\{32,\}' .env
```

Expected: `1`. Do not `cat` or echo `.env`.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If any test builds an env object by hand and now fails typecheck, add `PHONE_HASH_KEY: 'k'.repeat(32)` to it.

- [ ] **Step 5: Commit (not `.env`)**

```bash
git add src/config/env.ts .env.example
git commit -m "feat: require PHONE_HASH_KEY" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `users.phone_hash` and `findOrCreateUserByPhoneHash`

**Files:**
- Modify: `src/memory/schema.ts`
- Generate: `drizzle/0002_*.sql`, `drizzle/meta/*`
- Modify: `src/memory/types.ts`
- Modify: `src/memory/memory-repository.ts`
- Modify: `src/memory/memory-repository.test.ts`
- Modify (if typed `MemoryRepository`): `src/agent/tools/memory-tools.test.ts`, `src/memory/summarizer.test.ts`

- [ ] **Step 1: Add the column to the schema**

In `src/memory/schema.ts`, change the `users` table to add a unique nullable column after `notes`:

```ts
  phoneHash: text('phone_hash').unique('users_phone_hash_unique'),
```

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate --name caller_phone_hash`
Expected: creates `drizzle/0002_caller_phone_hash.sql` containing `ALTER TABLE "users" ADD COLUMN "phone_hash" text;` and a unique constraint `users_phone_hash_unique`, and updates `drizzle/meta/_journal.json`. Open the SQL file and confirm it only adds that column and constraint.

- [ ] **Step 3: Add the method to the interface**

In `src/memory/types.ts`, add to `MemoryRepository` (before `clearMemory`):

```ts
  /** Atomically finds the user with this phone hash or creates one; returns the user id. */
  findOrCreateUserByPhoneHash(phoneHash: string): Promise<string>;
```

- [ ] **Step 4: Write the failing repository tests**

In `src/memory/memory-repository.test.ts`, add inside the top-level `describe`:

```ts
  it('findOrCreateUserByPhoneHash returns the same user for the same hash', async () => {
    const first = await repo.findOrCreateUserByPhoneHash('a'.repeat(64));
    const second = await repo.findOrCreateUserByPhoneHash('a'.repeat(64));
    const other = await repo.findOrCreateUserByPhoneHash('b'.repeat(64));
    expect(second).toBe(first);
    expect(other).not.toBe(first);
  });

  it('findOrCreateUserByPhoneHash creates exactly one user under concurrent calls', async () => {
    const ids = await Promise.all(
      Array.from({ length: 10 }, () => repo.findOrCreateUserByPhoneHash('c'.repeat(64))),
    );
    expect(new Set(ids).size).toBe(1);
  });

  it('keeps each caller memory separate', async () => {
    const a = await repo.findOrCreateUserByPhoneHash('d'.repeat(64));
    const b = await repo.findOrCreateUserByPhoneHash('e'.repeat(64));
    await repo.upsertDeceased(a, { name: 'דוד' });
    expect((await repo.loadMemory(a)).deceased).toHaveLength(1);
    expect((await repo.loadMemory(b)).deceased).toHaveLength(0);
  });
```

- [ ] **Step 5: Run to verify failure**

Run: `npx vitest run src/memory/memory-repository.test.ts`
Expected: FAIL (`findOrCreateUserByPhoneHash is not a function`).

- [ ] **Step 6: Implement it**

In `src/memory/memory-repository.ts`, add `randomUUID` import at the top (`import { randomUUID } from 'node:crypto';`) and this method before `clearMemory`:

```ts
  async findOrCreateUserByPhoneHash(phoneHash: string): Promise<string> {
    await this.db
      .insert(users)
      .values({ id: randomUUID(), phoneHash })
      .onConflictDoNothing({ target: users.phoneHash });
    const [row] = await this.db.select({ id: users.id }).from(users).where(eq(users.phoneHash, phoneHash));
    if (!row) throw new Error('failed to resolve user for phone hash');
    return row.id;
  }
```

- [ ] **Step 7: Fix fake repositories**

Run: `npm run typecheck`. For each test file that builds a `MemoryRepository` object literal and now errors, add `findOrCreateUserByPhoneHash: vi.fn(),` next to the other fields (for example in `fakeRepo` in `src/agent/tools/memory-tools.test.ts`).

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/memory drizzle src/agent/tools/memory-tools.test.ts
git commit -m "feat: users.phone_hash and atomic find-or-create by phone hash" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `resolveUserId`

**Files:**
- Create: `src/memory/caller-identity.ts`
- Test: `src/memory/caller-identity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/memory/caller-identity.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { DEMO_USER_ID } from '../config/demo-user.js';
import { resolveUserId } from './caller-identity.js';
import { hashPhone } from './phone.js';

const KEY = 'k'.repeat(32);

describe('resolveUserId', () => {
  it('returns the demo user for a non-SIP participant', async () => {
    const repo = { findOrCreateUserByPhoneHash: vi.fn() };
    const id = await resolveUserId({ isSip: false, attributes: {} }, repo, KEY);
    expect(id).toBe(DEMO_USER_ID);
    expect(repo.findOrCreateUserByPhoneHash).not.toHaveBeenCalled();
  });

  it('looks up the SIP caller by hashed, normalized number', async () => {
    const repo = { findOrCreateUserByPhoneHash: vi.fn().mockResolvedValue('user-123') };
    const id = await resolveUserId({ isSip: true, attributes: { 'sip.phoneNumber': '+972 50-123-4567' } }, repo, KEY);
    expect(id).toBe('user-123');
    expect(repo.findOrCreateUserByPhoneHash).toHaveBeenCalledWith(hashPhone('+972501234567', KEY));
  });

  it('returns null (anonymous) for a SIP caller with no valid number', async () => {
    const repo = { findOrCreateUserByPhoneHash: vi.fn() };
    expect(await resolveUserId({ isSip: true, attributes: {} }, repo, KEY)).toBeNull();
    expect(await resolveUserId({ isSip: true, attributes: { 'sip.phoneNumber': 'anonymous' } }, repo, KEY)).toBeNull();
    expect(repo.findOrCreateUserByPhoneHash).not.toHaveBeenCalled();
  });

  it('returns null when the repository throws', async () => {
    const repo = { findOrCreateUserByPhoneHash: vi.fn().mockRejectedValue(new Error('db down')) };
    const id = await resolveUserId({ isSip: true, attributes: { 'sip.phoneNumber': '+972501234567' } }, repo, KEY);
    expect(id).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/memory/caller-identity.test.ts`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement**

Create `src/memory/caller-identity.ts`:

```ts
import { DEMO_USER_ID } from '../config/demo-user.js';
import { createLogger } from '../logger.js';
import { hashPhone, normalizePhone } from './phone.js';
import type { MemoryRepository } from './types.js';

const log = createLogger('caller-identity');

/** Participant attribute LiveKit sets on SIP participants with the caller's number. */
export const SIP_PHONE_ATTRIBUTE = 'sip.phoneNumber';

export interface CallerParticipant {
  isSip: boolean;
  attributes: Record<string, string>;
}

/**
 * Maps the participant to a user id: the demo user for web, a per-number user for SIP callers,
 * and null (anonymous, nothing saved) when the number is hidden or the lookup fails.
 */
export async function resolveUserId(
  participant: CallerParticipant,
  repo: Pick<MemoryRepository, 'findOrCreateUserByPhoneHash'>,
  hashKey: string,
): Promise<string | null> {
  if (!participant.isSip) return DEMO_USER_ID;

  const phone = normalizePhone(participant.attributes[SIP_PHONE_ATTRIBUTE]);
  if (!phone) return null;

  try {
    return await repo.findOrCreateUserByPhoneHash(hashPhone(phone, hashKey));
  } catch (err) {
    log.error({ err }, 'failed to resolve caller, continuing anonymously');
    return null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/memory/caller-identity.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/memory/caller-identity.ts src/memory/caller-identity.test.ts
git commit -m "feat: resolve caller to a user id by hashed phone number" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wire it into the agent, with anonymous mode

**Files:**
- Modify: `src/agent/main.ts`

`main.ts` has no unit tests (it needs a live LiveKit job), so this task is verified by typecheck, the full suite, and Task 6.

- [ ] **Step 1: Update imports**

In `src/agent/main.ts`:
- Remove `import { DEMO_USER_ID } from '../config/demo-user.js';`
- Add `import { ParticipantKind } from '@livekit/rtc-node';`
- Add `import { resolveUserId } from '../memory/caller-identity.js';`

If `@livekit/rtc-node` does not resolve in typecheck, run `npm ls @livekit/rtc-node` and install the exact installed version as a direct dependency (`npm i @livekit/rtc-node@<that version>`).

- [ ] **Step 2: Connect first, identify the caller, then load memory**

Replace the start of `entry` (from `const env = loadEnv();` through the end of the `try/catch` that loads memory) with:

```ts
    const env = loadEnv();
    const startedAt = new Date();
    const callLog = log.child({ room: ctx.room.name });

    const { db, close } = createDb(env.DATABASE_URL);
    const repo = new DrizzleMemoryRepository(db);

    // The caller's number arrives as a participant attribute, so connect before loading memory.
    await ctx.connect();
    const participant = await ctx.waitForParticipant();
    callLog.info(
      { kind: participant.kind, attributeKeys: Object.keys(participant.attributes) },
      'caller joined',
    );
    const userId = await resolveUserId(
      { isSip: participant.kind === ParticipantKind.SIP, attributes: participant.attributes },
      repo,
      env.PHONE_HASH_KEY,
    );
    callLog.info({ anonymous: userId === null }, userId === null ? 'anonymous call' : 'call started');

    // A memory failure must never prevent the call from happening.
    let memoryBlock = '';
    if (userId) {
      const loadStarted = Date.now();
      try {
        const memory = await repo.loadMemory(userId);
        memoryBlock = formatMemory(memory);
        callLog.info(
          { ms: Date.now() - loadStarted, deceased: memory.deceased.length, summaries: memory.recentSummaries.length, returning: memoryBlock !== '' },
          'memory loaded',
        );
      } catch (err) {
        callLog.error({ err }, 'failed to load user memory, continuing without it');
      }
    }
```

Logging only attribute **keys** keeps the number out of the log. Do not log `participant.attributes` values or `userId` hashes.

- [ ] **Step 3: Skip the summary for anonymous calls**

In the `ctx.addShutdownCallback` body, wrap the `finalizeCall` race so it runs only when `userId` is set. Replace the `try { await Promise.race([...]) } catch ... finally { await close(); }` block with:

```ts
      try {
        if (userId) {
          await Promise.race([
            finalizeCall({
              repo,
              analyzer: createOpenAiAnalyzer(env.OPENAI_API_KEY),
              userId,
              transcript,
              startedAt,
              endedAt: new Date(),
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('finalizeCall timed out')), FINALIZE_TIMEOUT_MS),
            ),
          ]);
        }
      } catch (err) {
        callLog.error({ err }, 'failed to save call summary');
      } finally {
        await close();
      }
```

- [ ] **Step 4: Register memory tools only for identified callers, and drop the late connect**

Replace the tools array and the final lines of `entry` with:

```ts
    const assistant = new HebrewAssistant(buildInstructions(memoryBlock), [
      ...langchainTools,
      ...(userId ? createMemoryTools(repo, userId, publishEvent) : []),
      ...createModeTools(modeController, publishEvent),
      createIdoMasalaTool(publishEvent),
    ]);

    await session.start({ agent: assistant, room: ctx.room });
    callLog.info('agent ready, greeting');
    session.generateReply({ instructions: buildGreeting(memoryBlock !== '') });
```

(`ctx.connect()` now happens earlier, so the old `await ctx.connect();` line is removed.)

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/agent/main.ts package.json package-lock.json
git commit -m "feat: per-caller memory in the agent, anonymous mode for hidden numbers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Apply the migration, restart, and verify on real calls

**Files:** none (runtime verification). This task is done by the controller together with the user, not by an implementer subagent.

- [ ] **Step 1: Migrate the real database** (adds one nullable column; no data is changed)

Run: `npm run db:migrate`
Expected: completes without error. The demo user's data is unchanged.

- [ ] **Step 2: Restart the agent and server**

```bash
pkill -f "src/agent/main.ts"; pkill -f "src/server/main.ts"; sleep 2
(nohup npm run dev:agent > /tmp/agent.log 2>&1 &); (nohup npm run dev:server > /tmp/server.log 2>&1 &)
sleep 8; curl -s -o /dev/null -w "web %{http_code}\n" http://localhost:3100
```

Expected: `web 200`; the agent log shows it registered.

- [ ] **Step 3: Web check**

Open http://localhost:3100, start a conversation. In `/tmp/agent.log`: `caller joined` with `kind: 0`, then `call started` and `memory loaded`. The demo user's memory still loads.

- [ ] **Step 4: Phone check, confirm the attribute key**

Call the Twilio number. In `/tmp/agent.log`, the `caller joined` line has `kind: 3` and `attributeKeys` should include `sip.phoneNumber`. If the key is named differently, change `SIP_PHONE_ATTRIBUTE` in `src/memory/caller-identity.ts` to the real name and re-run `npm test`.

- [ ] **Step 5: Separation check**

With phone A: tell the agent a name, hang up. Call again from A: it should remember. Call from phone B (or a second number): it should not know A's data. Call with caller ID hidden: log shows `anonymous call`, and no `memory loaded` or summary is written.

- [ ] **Step 6: Report**

Tell the user the results. Do not push to GitHub until the user asks.
