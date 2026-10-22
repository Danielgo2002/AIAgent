# Cross-Session User Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Hebrew grief-support voice agent remembers each caller across calls (who died, when, profile, per-call summaries) using Postgres, and loads that memory at the start of every session.

**Architecture:** A `src/memory/` layer (Drizzle schema, repository, formatter, summarizer) is the only code that knows SQL. The agent loads memory for a hardcoded `DEMO_USER_ID`, appends a formatted Hebrew block to its instructions, exposes LangChain tools so the Realtime model can save key facts live, and on session shutdown runs a LangChain structured-output pass over the transcript to write a call summary and fill gaps.

**Tech Stack:** TypeScript (ESM), Drizzle ORM + `pg`, PostgreSQL (docker-compose, host port 5433), `@langchain/core` + `@langchain/openai`, `@livekit/agents`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-user-memory-design.md`. Two refinements made while planning: (1) `deceased` uniqueness is `(user_id, name)` on the trimmed name rather than `lower(name)` (keeps upserts simple); (2) call-finalization logic lives in `src/memory/summarizer.ts` next to the analyzer.

**Note:** the project is not a git repository, so there are no commit steps. If you `git init`, commit after each task.

---

## File Structure

```
docker-compose.yml                       local Postgres (port 5433)
drizzle.config.ts                        drizzle-kit config (migrations → ./drizzle)
vitest.config.ts                         test config + global setup
tests/global-setup.ts                    creates the podcusts_test database if missing
src/config/env.ts                        (modify) add DATABASE_URL
src/config/demo-user.ts                  DEMO_USER_ID constant (single swap point for auth)
src/memory/schema.ts                     Drizzle tables
src/memory/db.ts                         pool + drizzle client factory
src/memory/migrate.ts                    CLI: apply migrations
src/memory/types.ts                      zod input schemas + UserMemory type
src/memory/memory-repository.ts          MemoryRepository interface + Drizzle implementation
src/memory/memory-repository.test.ts     integration tests
src/memory/test-support.ts               test DB helper
src/memory/memory-formatter.ts           memory → Hebrew prompt block
src/memory/memory-formatter.test.ts
src/memory/summarizer.ts                 analyzer schema/prompt + finalizeCall
src/memory/summarizer.test.ts
src/agent/tools/memory-tools.ts          LangChain tools bound to repo + userId
src/agent/tools/memory-tools.test.ts
src/agent/instructions.ts                (modify) buildInstructions / buildGreeting
src/agent/assistant.ts                   (modify) accept instructions + tools
src/agent/main.ts                        (modify) load memory, wire tools, finalize on shutdown
```

---

### Task 1: Dependencies, Postgres, config, test runner

**Files:**
- Modify: `package.json`, `src/config/env.ts`, `.env.example`, `.env`
- Create: `docker-compose.yml`, `drizzle.config.ts`, `vitest.config.ts`, `tests/global-setup.ts`, `src/config/demo-user.ts`

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/danielgoldenberg/Desktop/podcusts
npm i drizzle-orm pg @langchain/openai
npm i -D drizzle-kit @types/pg vitest
```

- [ ] **Step 2: Add scripts to `package.json`** (merge into existing `scripts`)

```json
"db:up": "docker compose up -d postgres",
"db:generate": "drizzle-kit generate",
"db:migrate": "tsx --env-file=.env src/memory/migrate.ts",
"test": "vitest run"
```

- [ ] **Step 3: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: podcusts
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

- [ ] **Step 4: Create `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/memory/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
```

- [ ] **Step 5: Create `vitest.config.ts` and `tests/global-setup.ts`**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globalSetup: ['tests/global-setup.ts'], include: ['src/**/*.test.ts'] },
});
```

```ts
// tests/global-setup.ts
import { Client } from 'pg';

const DEFAULT_URL = 'postgres://postgres:postgres@localhost:5433/podcusts_test';

/** Creates the dedicated test database if it does not exist yet. */
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_URL);
  const dbName = url.pathname.slice(1);
  const admin = new Client({ connectionString: new URL('/postgres', url).toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
    if (!rowCount) await admin.query(`create database "${dbName}"`);
  } finally {
    await admin.end();
  }
}
```

- [ ] **Step 6: Create `src/config/demo-user.ts`**

```ts
/** Demo only: every caller is this user. Replace with real authentication later. */
export const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';
```

- [ ] **Step 7: Add `DATABASE_URL` to env schema** — in `src/config/env.ts` add to the zod object:

```ts
  DATABASE_URL: z.string().min(1).default('postgres://postgres:postgres@localhost:5433/podcusts'),
```

Append `DATABASE_URL=postgres://postgres:postgres@localhost:5433/podcusts` to `.env.example` and `.env`.

- [ ] **Step 8: Start Postgres and verify**

Run: `npm run db:up && sleep 4 && docker compose exec postgres pg_isready -U postgres`
Expected: `/var/run/postgresql:5432 - accepting connections`

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

---

### Task 2: Schema, DB client, migrations

**Files:**
- Create: `src/memory/schema.ts`, `src/memory/db.ts`, `src/memory/migrate.ts`, `drizzle/` (generated)

- [ ] **Step 1: Create `src/memory/schema.ts`**

```ts
import { date, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  firstName: text('first_name'),
  addressAs: text('address_as'),
  gender: text('gender', { enum: ['male', 'female', 'other'] }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const deceased = pgTable(
  'deceased',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    relationship: text('relationship'),
    dateOfDeath: date('date_of_death', { mode: 'string' }),
    circumstances: text('circumstances'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('deceased_user_name_unique').on(t.userId, t.name)],
);

export const callSummaries = pgTable('call_summaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
  summary: text('summary').notNull(),
  mood: text('mood'),
  openThreads: text('open_threads').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Create `src/memory/db.ts`**

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}

export type Db = ReturnType<typeof createDb>['db'];
```

- [ ] **Step 3: Create `src/memory/migrate.ts`**

```ts
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../config/env.js';
import { createDb } from './db.js';

const { db, close } = createDb(loadEnv().DATABASE_URL);
await migrate(db, { migrationsFolder: 'drizzle' });
await close();
console.log('migrations applied');
```

- [ ] **Step 4: Generate and apply the migration**

Run: `npm run db:generate && npm run db:migrate`
Expected: a `drizzle/0000_*.sql` file is created and `migrations applied` is printed.

- [ ] **Step 5: Verify tables exist**

Run: `docker compose exec postgres psql -U postgres -d podcusts -c '\dt'`
Expected: lists `users`, `deceased`, `call_summaries`.

---

### Task 3: Types and repository (TDD)

**Files:**
- Create: `src/memory/types.ts`, `src/memory/memory-repository.ts`, `src/memory/test-support.ts`
- Test: `src/memory/memory-repository.test.ts`

- [ ] **Step 1: Create `src/memory/types.ts`**

```ts
import { z } from 'zod';
import type { callSummaries, deceased, users } from './schema.js';

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
  /** Most recent first. */
  recentSummaries: (typeof callSummaries.$inferSelect)[];
}

export interface MemoryRepository {
  loadMemory(userId: string): Promise<UserMemory>;
  upsertDeceased(userId: string, input: DeceasedInput): Promise<void>;
  updateUser(userId: string, input: UserUpdate): Promise<void>;
  saveCallSummary(userId: string, input: CallSummaryInput): Promise<void>;
}
```

- [ ] **Step 2: Create `src/memory/test-support.ts`**

```ts
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './db.js';
import { DrizzleMemoryRepository } from './memory-repository.js';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/podcusts_test';

/** Migrated, empty test database plus a repository bound to it. */
export async function createTestRepo() {
  const { db, close } = createDb(TEST_DATABASE_URL);
  await migrate(db, { migrationsFolder: 'drizzle' });
  await db.execute(sql`truncate table users, deceased, call_summaries cascade`);
  return { repo: new DrizzleMemoryRepository(db), close };
}
```

- [ ] **Step 3: Write the failing tests** — `src/memory/memory-repository.test.ts`

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { DrizzleMemoryRepository } from './memory-repository.js';
import { createTestRepo } from './test-support.js';

const USER = '00000000-0000-0000-0000-000000000001';

let repo: DrizzleMemoryRepository;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ repo, close } = await createTestRepo());
});
afterAll(async () => close?.());

describe('DrizzleMemoryRepository', () => {
  it('creates the user on first load and returns empty memory', async () => {
    const memory = await repo.loadMemory(USER);
    expect(memory.user.id).toBe(USER);
    expect(memory.deceased).toEqual([]);
    expect(memory.recentSummaries).toEqual([]);
  });

  it('upserts a deceased person and merges later updates without erasing fields', async () => {
    await repo.upsertDeceased(USER, { name: 'דוד', relationship: 'אב', dateOfDeath: '2025-03-01' });
    await repo.upsertDeceased(USER, { name: ' דוד ', notes: 'אהב לשחק שחמט' });
    await repo.upsertDeceased(USER, { name: 'דוד', notes: 'היה נהג מונית' });

    const { deceased } = await repo.loadMemory(USER);
    expect(deceased).toHaveLength(1);
    expect(deceased[0]).toMatchObject({ name: 'דוד', relationship: 'אב', dateOfDeath: '2025-03-01' });
    expect(deceased[0]?.notes).toBe('אהב לשחק שחמט\nהיה נהג מונית');
  });

  it('updates user fields and appends notes', async () => {
    await repo.updateUser(USER, { firstName: 'נועה', gender: 'female', notes: 'מעדיפה שקט' });
    await repo.updateUser(USER, { notes: 'לא לדבר על הלוויה' });

    const { user } = await repo.loadMemory(USER);
    expect(user).toMatchObject({ firstName: 'נועה', gender: 'female' });
    expect(user.notes).toBe('מעדיפה שקט\nלא לדבר על הלוויה');
  });

  it('returns the 3 most recent call summaries, newest first', async () => {
    for (let i = 1; i <= 4; i++) {
      await repo.saveCallSummary(USER, {
        startedAt: new Date(2025, 0, i),
        endedAt: new Date(2025, 0, i, 0, 10),
        summary: `שיחה ${i}`,
        openThreads: i === 4 ? ['הלוויה'] : [],
      });
    }
    const { recentSummaries } = await repo.loadMemory(USER);
    expect(recentSummaries.map((s) => s.summary)).toEqual(['שיחה 4', 'שיחה 3', 'שיחה 2']);
    expect(recentSummaries[0]?.openThreads).toEqual(['הלוויה']);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./memory-repository.js`.

- [ ] **Step 5: Implement `src/memory/memory-repository.ts`**

```ts
import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from './db.js';
import { callSummaries, deceased, users } from './schema.js';
import type {
  CallSummaryInput,
  DeceasedInput,
  MemoryRepository,
  UserMemory,
  UserUpdate,
} from './types.js';

const RECENT_SUMMARIES = 3;

/** Drops undefined values so a partial update never erases existing data. */
function defined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** SQL that appends a new note on a new line to an existing nullable text column. */
const appendNote = (column: typeof users.notes | typeof deceased.notes, note: string) =>
  sql`concat_ws(E'\n', nullif(${column}, ''), ${note})`;

export class DrizzleMemoryRepository implements MemoryRepository {
  constructor(private readonly db: Db) {}

  async loadMemory(userId: string): Promise<UserMemory> {
    await this.ensureUser(userId);
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new Error(`User ${userId} not found`);

    const dead = await this.db
      .select()
      .from(deceased)
      .where(eq(deceased.userId, userId))
      .orderBy(deceased.createdAt);
    const recentSummaries = await this.db
      .select()
      .from(callSummaries)
      .where(eq(callSummaries.userId, userId))
      .orderBy(desc(callSummaries.startedAt))
      .limit(RECENT_SUMMARIES);

    return { user, deceased: dead, recentSummaries };
  }

  async upsertDeceased(userId: string, input: DeceasedInput): Promise<void> {
    await this.ensureUser(userId);
    const name = input.name.trim();
    const { notes, ...rest } = defined({ ...input, name });

    const update = {
      ...defined({
        relationship: rest.relationship,
        dateOfDeath: rest.dateOfDeath,
        circumstances: rest.circumstances,
      }),
      ...(notes ? { notes: appendNote(deceased.notes, notes) } : {}),
    };

    const insert = this.db.insert(deceased).values({ userId, ...rest, notes });
    if (Object.keys(update).length === 0) {
      await insert.onConflictDoNothing({ target: [deceased.userId, deceased.name] });
    } else {
      await insert.onConflictDoUpdate({ target: [deceased.userId, deceased.name], set: update });
    }
  }

  async updateUser(userId: string, input: UserUpdate): Promise<void> {
    await this.ensureUser(userId);
    const { notes, ...rest } = input;
    await this.db
      .update(users)
      .set({
        ...defined(rest),
        ...(notes ? { notes: appendNote(users.notes, notes) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  async saveCallSummary(userId: string, input: CallSummaryInput): Promise<void> {
    await this.ensureUser(userId);
    await this.db.insert(callSummaries).values({ userId, ...input });
  }

  private async ensureUser(userId: string): Promise<void> {
    await this.db.insert(users).values({ id: userId }).onConflictDoNothing();
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 4 tests. If the first insert in `upsertDeceased` stores `notes` as the raw note on insert and the append on conflict, the merge test passes as written.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

---

### Task 4: Memory formatter (TDD)

**Files:**
- Create: `src/memory/memory-formatter.ts`
- Test: `src/memory/memory-formatter.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { formatMemory } from './memory-formatter.js';
import type { UserMemory } from './types.js';

const base = (): UserMemory => ({
  user: {
    id: 'u1',
    firstName: null,
    addressAs: null,
    gender: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  deceased: [],
  recentSummaries: [],
});

describe('formatMemory', () => {
  it('returns an empty string when nothing is known', () => {
    expect(formatMemory(base())).toBe('');
  });

  it('includes profile, deceased and summaries', () => {
    const memory = base();
    memory.user.firstName = 'נועה';
    memory.user.gender = 'female';
    memory.user.notes = 'מעדיפה שקט';
    memory.deceased.push({
      id: 'd1',
      userId: 'u1',
      name: 'דוד',
      relationship: 'אב',
      dateOfDeath: '2025-03-01',
      circumstances: null,
      notes: 'אהב שחמט',
      createdAt: new Date(),
    });
    memory.recentSummaries.push({
      id: 's1',
      userId: 'u1',
      startedAt: new Date('2025-04-02T10:00:00Z'),
      endedAt: new Date('2025-04-02T10:10:00Z'),
      summary: 'דיברנו על ההלוויה',
      mood: 'עצובה',
      openThreads: ['שיחה עם האחות'],
      createdAt: new Date(),
    });

    const text = formatMemory(memory);
    expect(text).toContain('נועה');
    expect(text).toContain('לשון נקבה');
    expect(text).toContain('מעדיפה שקט');
    expect(text).toContain('דוד');
    expect(text).toContain('אב');
    expect(text).toContain('2025-03-01');
    expect(text).toContain('אהב שחמט');
    expect(text).toContain('דיברנו על ההלוויה');
    expect(text).toContain('שיחה עם האחות');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/memory/memory-formatter.test.ts`
Expected: FAIL — cannot resolve `./memory-formatter.js`.

- [ ] **Step 3: Implement `src/memory/memory-formatter.ts`**

```ts
import type { UserMemory } from './types.js';

const GENDER_HINT = {
  male: 'פנה אליו בלשון זכר',
  female: 'פני אליה בלשון נקבה',
  other: 'השתמש בניסוח ניטרלי',
} as const;

/** Renders stored memory as a Hebrew block for the agent's instructions. Empty if nothing is known. */
export function formatMemory({ user, deceased, recentSummaries }: UserMemory): string {
  const profile = [
    user.firstName && `שם: ${user.firstName}`,
    user.addressAs && `מעדיף/ה שיפנו אליו/ה כ: ${user.addressAs}`,
    user.gender && `מגדר: ${GENDER_HINT[user.gender]} (לשון ${user.gender === 'female' ? 'נקבה' : user.gender === 'male' ? 'זכר' : 'ניטרלית'})`,
    user.notes && `מה עוזר / ממה להימנע:\n${user.notes}`,
  ].filter(Boolean);

  const lost = deceased.map((d) =>
    [
      `- ${d.name}`,
      d.relationship && `(${d.relationship})`,
      d.dateOfDeath && `נפטר/ה ב-${d.dateOfDeath}`,
      d.circumstances && `נסיבות: ${d.circumstances}`,
      d.notes && `הערות: ${d.notes.replaceAll('\n', '; ')}`,
    ]
      .filter(Boolean)
      .join(' '),
  );

  const calls = recentSummaries.map((s) => {
    const threads = s.openThreads.length ? ` (נושאים פתוחים: ${s.openThreads.join(', ')})` : '';
    return `- ${s.startedAt.toISOString().slice(0, 10)}: ${s.summary}${threads}`;
  });

  if (!profile.length && !lost.length && !calls.length) return '';

  return [
    'מה שאת/ה כבר יודע/ת על האדם שמדבר איתך, משיחות קודמות. השתמש/י בזה בטבעיות ובעדינות, ואל תקריא/י את זה כרשימה:',
    ...(profile.length ? ['\nפרופיל:', ...profile.map((p) => `- ${p}`)] : []),
    ...(lost.length ? ['\nיקיריו שנפטרו:', ...lost] : []),
    ...(calls.length ? ['\nסיכומי שיחות אחרונות (מהחדשה לישנה):', ...calls] : []),
  ].join('\n');
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/memory/memory-formatter.test.ts`
Expected: PASS, 2 tests. (The gender test asserts `לשון נקבה`, which the female hint line produces.)

---

### Task 5: Memory tools (TDD)

**Files:**
- Create: `src/agent/tools/memory-tools.ts`
- Test: `src/agent/tools/memory-tools.test.ts`
- Modify: `src/agent/tools/index.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import type { MemoryRepository } from '../../memory/types.js';
import { createMemoryTools } from './memory-tools.js';

const fakeRepo = (overrides: Partial<MemoryRepository> = {}): MemoryRepository => ({
  loadMemory: vi.fn(),
  upsertDeceased: vi.fn().mockResolvedValue(undefined),
  updateUser: vi.fn().mockResolvedValue(undefined),
  saveCallSummary: vi.fn(),
  ...overrides,
});

const byName = (tools: ReturnType<typeof createMemoryTools>, name: string) =>
  tools.find((t) => t.name === name)!;

describe('memory tools', () => {
  it('remember_deceased saves through the repository for the bound user', async () => {
    const repo = fakeRepo();
    const tools = createMemoryTools(repo, 'user-1');

    const result = await byName(tools, 'remember_deceased').invoke({
      name: 'דוד',
      relationship: 'אב',
      dateOfDeath: '2025-03-01',
    });

    expect(repo.upsertDeceased).toHaveBeenCalledWith('user-1', {
      name: 'דוד',
      relationship: 'אב',
      dateOfDeath: '2025-03-01',
    });
    expect(result).toBe('נשמר');
  });

  it('remember_about_user saves profile updates', async () => {
    const repo = fakeRepo();
    const tools = createMemoryTools(repo, 'user-1');

    await byName(tools, 'remember_about_user').invoke({ firstName: 'נועה', gender: 'female' });

    expect(repo.updateUser).toHaveBeenCalledWith('user-1', { firstName: 'נועה', gender: 'female' });
  });

  it('returns a soft error instead of throwing when the database fails', async () => {
    const repo = fakeRepo({ upsertDeceased: vi.fn().mockRejectedValue(new Error('db down')) });
    const tools = createMemoryTools(repo, 'user-1');

    const result = await byName(tools, 'remember_deceased').invoke({ name: 'דוד' });

    expect(result).toContain('לא הצלחתי לשמור');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/agent/tools/memory-tools.test.ts`
Expected: FAIL — cannot resolve `./memory-tools.js`.

- [ ] **Step 3: Implement `src/agent/tools/memory-tools.ts`**

```ts
import { tool } from '@langchain/core/tools';
import type { MemoryRepository } from '../../memory/types.js';
import { deceasedInputSchema, userUpdateSchema } from '../../memory/types.js';

const SAVED = 'נשמר';
const FAILED = 'לא הצלחתי לשמור כרגע. המשך/י את השיחה כרגיל ואל תזכיר/י זאת למשתמש.';

/** Tools that let the voice model save important facts while the call is in progress. */
export function createMemoryTools(repo: MemoryRepository, userId: string) {
  const safely = async (save: () => Promise<void>) => {
    try {
      await save();
      return SAVED;
    } catch (err) {
      console.error('memory tool failed', err);
      return FAILED;
    }
  };

  const rememberDeceased = tool(
    async (input) => safely(() => repo.upsertDeceased(userId, input)),
    {
      name: 'remember_deceased',
      description:
        'שמור פרטים על אדם יקר שנפטר כשהמשתמש משתף אותם: שם, קרבה, תאריך פטירה, נסיבות, או פרט אישי. אפשר לקרוא שוב עם אותו שם כדי להוסיף פרטים. קרא/י בשקט, בלי להכריז על כך.',
      schema: deceasedInputSchema,
    },
  );

  const rememberAboutUser = tool(
    async (input) => safely(() => repo.updateUser(userId, input)),
    {
      name: 'remember_about_user',
      description:
        'שמור פרטים על המשתמש עצמו: שם, איך לפנות אליו, מגדר, מה עוזר לו או ממה להימנע. קרא/י בשקט, בלי להכריז על כך.',
      schema: userUpdateSchema,
    },
  );

  return [rememberDeceased, rememberAboutUser];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/agent/tools/memory-tools.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Export from `src/agent/tools/index.ts`** — replace file contents with:

```ts
import { currentTime } from './current-time.js';

export { createMemoryTools } from './memory-tools.js';

/** Stateless LangChain tools; memory tools are created per session (they need the repository + user). */
export const langchainTools = [currentTime];
```

---

### Task 6: Post-call summarizer (TDD)

**Files:**
- Create: `src/memory/summarizer.ts`
- Test: `src/memory/summarizer.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { finalizeCall, type CallAnalysis } from './summarizer.js';
import type { MemoryRepository, UserMemory } from './types.js';

const emptyMemory: UserMemory = {
  user: { id: 'u', firstName: null, addressAs: null, gender: null, notes: null, createdAt: new Date(), updatedAt: new Date() },
  deceased: [],
  recentSummaries: [],
};

const repo = (): MemoryRepository => ({
  loadMemory: vi.fn().mockResolvedValue(emptyMemory),
  upsertDeceased: vi.fn().mockResolvedValue(undefined),
  updateUser: vi.fn().mockResolvedValue(undefined),
  saveCallSummary: vi.fn().mockResolvedValue(undefined),
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
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/memory/summarizer.test.ts`
Expected: FAIL — cannot resolve `./summarizer.js`.

- [ ] **Step 3: Implement `src/memory/summarizer.ts`**

```ts
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { formatMemory } from './memory-formatter.js';
import {
  deceasedInputSchema,
  userUpdateSchema,
  type MemoryRepository,
} from './types.js';

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

const withoutNulls = <T extends object>(input: T) =>
  Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null && v !== undefined));

function buildPrompt(transcript: TranscriptLine[], known: string): string {
  const lines = transcript.map((l) => `${l.role === 'user' ? 'מתקשר/ת' : 'עוזר/ת'}: ${l.text}`).join('\n');
  return [
    'להלן תמלול שיחת תמיכה עם אדם שאיבד יקיר/ה. נתח אותו.',
    '- כתוב סיכום קצר ועובדתי בעברית.',
    '- החזר ב-deceased וב-userUpdates רק מידע חדש שהמתקשר/ת אמר/ה בפירוש בשיחה הזו. אל תמציא ואל תחזור על מה שכבר ידוע.',
    '- אם אין מידע חדש, החזר רשימה ריקה / null בכל השדות.',
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
  if (!transcript.some((l) => l.role === 'user')) return;

  const memory = await repo.loadMemory(userId);
  const analysis = await analyzer.invoke(buildPrompt(transcript, formatMemory(memory)));

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
    if (name) await repo.upsertDeceased(userId, withoutNulls({ name, relationship, circumstances, notes }) as { name: string });
  }

  const userUpdate = userUpdateSchema.safeParse(withoutNulls(analysis.userUpdates));
  if (userUpdate.success && Object.keys(userUpdate.data).length > 0) {
    await repo.updateUser(userId, userUpdate.data);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/memory/summarizer.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `withStructuredOutput(analysisSchema)` does not satisfy `CallAnalyzer`, wrap it: `const model = ...withStructuredOutput(analysisSchema); return { invoke: (input) => model.invoke(input) };`.

---

### Task 7: Wire memory into the agent

**Files:**
- Modify: `src/agent/instructions.ts`, `src/agent/assistant.ts`, `src/agent/main.ts`

- [ ] **Step 1: Replace `src/agent/instructions.ts`**

```ts
const BASE_INSTRUCTIONS = `
את/ה מלווה קולי/ת תומך/ת בעברית בלבד, לאנשים שאיבדו יקיר/ה (שכול). 
- הקשב/י בסבלנות, ענה/י בקצרה ובחום, ואל תמהר/י לתת עצות או "פתרונות".
- אל תשתמש/י בקלישאות. אפשר לשתוק, לשקף את מה שנאמר, ולשאול שאלה פתוחה עדינה.
- אם המשתמש/ת עובר/ת לשפה אחרת, המשך/י בעברית אלא אם התבקשת אחרת.
- אם עולה סימן לסכנה לחיים או לפגיעה עצמית, עודד/י בעדינות לפנות מיד לעזרה דחופה (בישראל: ער"ן 1201, או 100/101) ולא להישאר לבד.
- כשהמשתמש/ת משתף/ת פרט חשוב (שם, קרבה, תאריך פטירה, מה עוזר לו/ה), שמור/י אותו בכלי remember_deceased או remember_about_user. עשה/י זאת בשקט, בלי להכריז על כך ובלי להפסיק את השיחה.
- אל תמציא/י מידע. השתמש/י בכלים הזמינים כשהם רלוונטיים.
`.trim();

export function buildInstructions(memoryBlock: string): string {
  return memoryBlock ? `${BASE_INSTRUCTIONS}\n\n${memoryBlock}` : BASE_INSTRUCTIONS;
}

const FIRST_GREETING = 'ברכי את המשתמש/ת בקצרה ובחום בעברית ושאלי במה אפשר לעזור.';
const RETURNING_GREETING =
  'זה אדם שכבר דיברת איתו. ברכי אותו/ה בחום בשמו/ה, ושאלי מה שלומו/ה היום. אפשר להתייחס בעדינות לנושא פתוח משיחה קודמת, אבל אל תכריחי ואל תקריאי סיכום.';

export function buildGreeting(hasMemory: boolean): string {
  return hasMemory ? RETURNING_GREETING : FIRST_GREETING;
}
```

- [ ] **Step 2: Replace `src/agent/assistant.ts`**

```ts
import { voice } from '@livekit/agents';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { toLivekitTools } from './tools/livekit-adapter.js';

export class HebrewAssistant extends voice.Agent {
  constructor(instructions: string, tools: StructuredToolInterface[]) {
    super({ instructions, tools: toLivekitTools(tools) });
  }
}
```

- [ ] **Step 3: Replace `src/agent/main.ts`**

```ts
import { fileURLToPath } from 'node:url';
import { cli, defineAgent, ServerOptions, voice, type JobContext } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import { DEMO_USER_ID } from '../config/demo-user.js';
import { loadEnv } from '../config/env.js';
import { createDb } from '../memory/db.js';
import { formatMemory } from '../memory/memory-formatter.js';
import { DrizzleMemoryRepository } from '../memory/memory-repository.js';
import { createOpenAiAnalyzer, finalizeCall, type TranscriptLine } from '../memory/summarizer.js';
import { HebrewAssistant } from './assistant.js';
import { buildGreeting, buildInstructions } from './instructions.js';
import { createMemoryTools, langchainTools } from './tools/index.js';

const FINALIZE_TIMEOUT_MS = 30_000;

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const env = loadEnv();
    const userId = DEMO_USER_ID;
    const startedAt = new Date();

    const { db, close } = createDb(env.DATABASE_URL);
    const repo = new DrizzleMemoryRepository(db);

    // A memory failure must never prevent the call from happening.
    let memoryBlock = '';
    try {
      memoryBlock = formatMemory(await repo.loadMemory(userId));
    } catch (err) {
      console.error('failed to load user memory, continuing without it', err);
    }

    const session = new voice.AgentSession({
      llm: new openai.realtime.RealtimeModel({
        apiKey: env.OPENAI_API_KEY,
        voice: 'coral',
        turnDetection: { type: 'semantic_vad' },
        inputAudioTranscription: { model: 'gpt-4o-transcribe', language: 'he' },
      }),
    });

    const transcript: TranscriptLine[] = [];
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, ({ item }) => {
      if (item.type !== 'message') return;
      const text = item.textContent;
      if (text && (item.role === 'user' || item.role === 'assistant')) {
        transcript.push({ role: item.role, text });
      }
    });

    ctx.addShutdownCallback(async () => {
      try {
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
      } catch (err) {
        console.error('failed to save call summary', err);
      } finally {
        await close();
      }
    });

    const assistant = new HebrewAssistant(buildInstructions(memoryBlock), [
      ...langchainTools,
      ...createMemoryTools(repo, userId),
    ]);

    await session.start({ agent: assistant, room: ctx.room });
    await ctx.connect();
    session.generateReply({ instructions: buildGreeting(memoryBlock !== '') });
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
```

- [ ] **Step 4: Typecheck and run all tests**

Run: `npm run typecheck && npm test`
Expected: no type errors; all tests pass (9 total). If `item.type`/`item.role`/`textContent` or the event enum name differ from the installed `@livekit/agents` 1.9.2 types, adjust to the names in `node_modules/@livekit/agents/dist/voice/events.d.ts` and `llm/chat_context.d.ts` (`ConversationItemAddedEvent.item` is `ChatMessage | AgentHandoffItem`).

---

### Task 8: End-to-end verification

- [ ] **Step 1: Make sure Postgres is up and migrated**

Run: `npm run db:up && npm run db:migrate`
Expected: `migrations applied`.

- [ ] **Step 2: Start LiveKit, agent, and server** (restart the existing agent/server processes so they pick up the new code; LiveKit server is already running in Docker on 7880)

Run (separate terminals): `npm run dev:agent` and `npm run dev:server`
Expected: agent logs `registered worker`; `curl localhost:3100/health` returns `{"status":"ok"}`.

- [ ] **Step 2b: First call**

Open http://localhost:3100, click start, and say in Hebrew: "שלום, קוראים לי נועה. אבא שלי דוד נפטר בראשון במרץ השנה." Then end the call.

- [ ] **Step 3: Verify data was written**

Run:
```bash
docker compose exec postgres psql -U postgres -d podcusts -c 'select first_name, gender, notes from users' -c 'select name, relationship, date_of_death from deceased' -c 'select started_at, summary, open_threads from call_summaries'
```
Expected: a `users` row with the name, a `deceased` row for דוד (father, with a date), and one `call_summaries` row (may take a few seconds after the call ends).

- [ ] **Step 4: Second call**

Start a new call. Expected: the agent greets you by name and may gently refer to your father or an open thread from the previous call.

- [ ] **Step 5: Failure check**

Run: `docker compose stop postgres`, start a call. Expected: the call still works with the first-time greeting, and the agent logs `failed to load user memory`. Then `docker compose start postgres`.
