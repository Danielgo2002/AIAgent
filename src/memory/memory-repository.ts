import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from './db.js';
import { callSummaries, companionPreferences, deceased, users } from './schema.js';
import type {
  CallSummaryInput,
  CompanionNote,
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
  sql`concat_ws(E'\n', nullif(${column}, ''), ${note}::text)`;

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
    const companion = await this.db
      .select()
      .from(companionPreferences)
      .where(eq(companionPreferences.userId, userId))
      .orderBy(companionPreferences.createdAt);
    const recentSummaries = await this.db
      .select()
      .from(callSummaries)
      .where(eq(callSummaries.userId, userId))
      .orderBy(desc(callSummaries.startedAt))
      .limit(RECENT_SUMMARIES);

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

  async clearMemory(userId: string): Promise<void> {
    await this.db.delete(users).where(eq(users.id, userId));
  }

  private async ensureUser(userId: string): Promise<void> {
    await this.db.insert(users).values({ id: userId }).onConflictDoNothing();
  }
}
