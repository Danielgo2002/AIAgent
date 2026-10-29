import { date, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  firstName: text('first_name'),
  addressAs: text('address_as'),
  gender: text('gender', { enum: ['male', 'female', 'other'] }),
  notes: text('notes'),
  phoneHash: text('phone_hash').unique('users_phone_hash_unique'),
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

export const COMPANION_CATEGORIES = ['likes', 'style', 'address', 'avoid', 'smiles', 'other'] as const;

export const companionPreferences = pgTable(
  'companion_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    category: text('category', { enum: COMPANION_CATEGORIES }).notNull(),
    note: text('note').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('companion_user_category_note_unique').on(t.userId, t.category, t.note)],
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
