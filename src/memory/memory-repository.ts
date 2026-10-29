import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from './db.js';
import { callSummaries, companionPreferences, deceased, users } from './schema.js';
import type {
  CallSummaryInput,
  CompanionNote,
  DeceasedInput,
  ListUsersParams,
  MemoryRepository,
  UserListItem,
  UserMemory,
  UserUpdate,
} from './types.js';

const RECENT_SUMMARIES = 3;
const MAX_LIST = 200;

/** Escapes LIKE wildcards so user search text is matched literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Drops undefined values so a partial update never erases existing data. */
function defined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** SQL that appends a new note on a new line to an existing nullable text column. */
const appendNote = (column: typeof users.notes | typeof deceased.notes, note: string) =>
  sql`concat_ws(E'\n', nullif(${column}, ''), ${note}::text)`;

export class DrizzleMemoryRepository implements MemoryRepository {
  constructor(private readonly db: Db) {}

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
    return (result.rows as unknown as Array<Omit<UserListItem, 'lastCallAt'> & { lastCallAt: string | Date | null }>).map(
      (row) => ({ ...row, lastCallAt: row.lastCallAt === null ? null : new Date(row.lastCallAt) }),
    );
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

    const insert = this.db.insert(deceased).values({ userId, name, ...rest, notes });
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

  async addCompanionNote(userId: string, input: CompanionNote): Promise<void> {
    await this.ensureUser(userId);
    await this.db
      .insert(companionPreferences)
      .values({ userId, category: input.category, note: input.note.trim() })
      .onConflictDoNothing();
  }

  async saveCallSummary(userId: string, input: CallSummaryInput): Promise<void> {
    await this.ensureUser(userId);
    await this.db.insert(callSummaries).values({ userId, ...input });
  }

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

  async clearMemory(userId: string): Promise<void> {
    await this.db.delete(users).where(eq(users.id, userId));
  }

  private async ensureUser(userId: string): Promise<void> {
    await this.db.insert(users).values({ id: userId }).onConflictDoNothing();
  }
}
