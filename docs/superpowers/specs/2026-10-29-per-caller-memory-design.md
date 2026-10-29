# Per-caller memory — Design Spec

Date: 2026-10-29
Status: Draft for review
Project: podcusts (Hebrew voice agent, LiveKit + OpenAI Realtime, Twilio phone line)

## 1. Goal

Every phone caller gets their own data in Postgres, and the agent knows that data when the same person calls again. Today `src/agent/main.ts` hardcodes `DEMO_USER_ID`, so every caller shares one memory.

## 2. Context

The memory layer is already per user: `users`, `deceased`, `companion_preferences` and `call_summaries` are keyed by `user_id` with cascading deletes, and `MemoryRepository`, `createMemoryTools`, the formatter and the summarizer all take a `userId`. The only missing piece is **identifying the caller** and mapping them to a `userId`. No change to the memory tables or tools is needed beyond one new column.

## 3. Decisions (made with the product owner)

| Question | Decision |
|---|---|
| Browser client at localhost:3100 | Stays the demo user. Only phone callers get per-number memory. |
| Phone number storage | Keyed hash (HMAC-SHA256) only. The raw number is never stored or logged. |
| Hidden or missing caller number | Anonymous call: no memory loaded, nothing saved. |
| Link between caller and user | A `phone_hash` column on `users` (not a separate identities table). |

## 4. Non-goals

- No login, verification or SMS code. The caller's identity is the number that Twilio and LiveKit report.
- No per-caller memory for the web client.
- No second identifier type (WhatsApp, email). If one appears later, move `phone_hash` to an identities table.
- No public deletion endpoint in this change (see 7.2).

## 5. Design

### 5.1 Reading the caller's number

When a job starts, the agent connects and waits for the first remote participant. If that participant is a SIP participant (`ParticipantKind.SIP`), its number is in the participant attributes. LiveKit documents the key as `sip.phoneNumber` (the caller) and `sip.trunkPhoneNumber` (the number dialed). Implementation must first confirm the key by logging attribute **names only** on a real call, then use it.

The number is normalised to E.164: strip spaces, dashes and parentheses, convert a leading `00` to `+`, and accept it only if it matches `^\+[1-9]\d{6,14}$`. Anything else counts as "no number".

### 5.2 Hashing

`hashPhone(e164, key)` returns the hex HMAC-SHA256 of the normalised number, with `PHONE_HASH_KEY` from `.env` as the key. `PHONE_HASH_KEY` is required (at least 32 characters, validated in `loadEnv`) and is never committed. Logs may show only the first 8 hex characters of a hash.

### 5.3 Resolving the user

One function, `resolveUserId(participant, repo, key)`, in a new file `src/memory/caller-identity.ts`:

- Non-SIP participant (web): returns `DEMO_USER_ID`.
- SIP participant with a valid number: returns the id of the `users` row with that `phone_hash`, creating it if missing.
- SIP participant without a valid number: returns `null` (anonymous).

Find-or-create is a single atomic statement so that two simultaneous calls from one number cannot create two users: `INSERT ... ON CONFLICT (phone_hash) DO NOTHING`, then `SELECT`. It lives on the repository as `findOrCreateUserByPhoneHash(hash): Promise<string>`.

### 5.4 Schema change

One Drizzle migration:

- `users.phone_hash text` — nullable, unique (`users_phone_hash_unique`).
- The demo user has `NULL`, which is allowed by the unique index.

### 5.5 Anonymous mode

When `userId` is `null`, `main.ts`:

- does not call `loadMemory` (the agent greets as a first-time caller),
- does not register the three memory tools (`remember_deceased`, `remember_about_user`, `remember_companion_preference`) (the call has nowhere to save),
- does not run the post-call summarizer,
- still registers the companion-mode and Ido Masala tools, which keep no state in the DB,
- logs `anonymous call`.

### 5.6 Failure handling

If resolving the identity throws (database down, bad attributes), the call continues as anonymous. A memory failure must never prevent the call, which matches the existing behavior of `loadMemory`. The error is logged without the number.

## 6. Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `src/memory/phone.ts` | `normalizePhone`, `hashPhone` (pure functions) | `node:crypto` |
| `src/memory/caller-identity.ts` | `resolveUserId` | `phone.ts`, `MemoryRepository` |
| `MemoryRepository.findOrCreateUserByPhoneHash` | Atomic find-or-create | Drizzle |
| `src/config/env.ts` | Adds `PHONE_HASH_KEY` | zod |
| `src/agent/main.ts` | Calls `resolveUserId`, handles `null` | the above |

## 7. Privacy and safety

1. **No raw numbers.** The number exists in memory during the call only. It is never written to the DB, logs, events published to the page, or the summarizer prompt.
2. **Right to be forgotten.** `clearMemory(userId)` already deletes a user and everything cascaded from them. A guarded way to call it for a given caller (an admin script taking a phone number, not a public route) is a follow-up. It must not be run against real data without explicit approval.
3. **Key custody.** If `PHONE_HASH_KEY` is lost or changed, returning callers are treated as new. Back it up; do not rotate it casually.
4. **One memory per number.** If a number is shared (a family phone), those people share memory. This is accepted for now.
5. **Test data.** Tests use a throwaway database and never touch the demo user's real rows.

## 8. Testing

- **Unit:** `normalizePhone` (spaces, dashes, `00` prefix, invalid, too short); `hashPhone` (stable for the same number and key, different for different keys, no raw digits in output).
- **Unit:** `resolveUserId` for web, SIP with number, SIP without number, and a repository that throws (returns `null`).
- **Repository:** `findOrCreateUserByPhoneHash` returns the same id on repeat, and ten concurrent calls with one hash produce exactly one row.
- **Agent wiring:** with `null`, memory tools and the summarizer are not used.
- **Manual:** call from phone A, tell the agent a name, hang up, call again from A and check it remembers; call from phone B and check it does not know A's data; call with the number hidden and check nothing is saved (`grep -a "anonymous call" /tmp/agent.log`).

## 9. Open items

- Confirm the `sip.phoneNumber` attribute key on a real call before coding against it.
- Decide later whether to add the admin delete script.
