# Cross-session user memory — design

## Goal
The Hebrew voice agent is a grief-support companion for bereaved people (שכולים). It must remember
what a caller shared in earlier calls and use it in the next one.

## Decisions
- **Identity:** hardcoded `DEMO_USER_ID` (demo only), isolated in `src/config/demo-user.ts` as the single swap point for real auth.
- **Capture:** both live tool calls (immediate, key facts) and a post-call LLM extraction (safety net + summary).
- **Storage:** PostgreSQL via Drizzle ORM + `pg`; local Postgres via `docker-compose.yml`.
- **LangChain:** tools (`@langchain/core`) and the summarizer (`@langchain/openai` structured output, default `gpt-4.1-mini`, same `OPENAI_API_KEY`).

## Data model
- `users`: id (uuid pk), first_name, address_as, gender (`male|female|other`, for Hebrew grammar), notes (what helps / what to avoid), created_at, updated_at.
- `deceased`: id, user_id → users, name, relationship, date_of_death (date, nullable), circumstances (nullable, sensitive), notes, created_at. Unique on (user_id, lower(name)) so upserts are idempotent.
- `call_summaries`: id, user_id → users, started_at, ended_at, summary (text), mood (text, nullable), open_threads (text[]), created_at.

## Components (`src/memory/`)
- `schema.ts` — Drizzle table definitions.
- `db.ts` — pg pool + drizzle client built from `DATABASE_URL`.
- `memory-repository.ts` — the only code that runs SQL: `loadMemory(userId)`, `upsertDeceased`, `updateUser`, `saveCallSummary`.
- `memory-formatter.ts` — pure function: loaded memory → Hebrew "what you know about this person" block (profile, deceased, last 3 summaries, open threads).
- `summarizer.ts` — transcript → `{summary, mood, openThreads, deceased[], userUpdates}` via LangChain structured output; result is applied through the repository.
- `src/agent/tools/memory-tools.ts` — LangChain tools `remember_deceased`, `remember_about_user`, bound to a repository + userId, registered through the existing LiveKit adapter.

## Data flow
1. **Call start:** `main.ts` loads memory for `DEMO_USER_ID`; instructions = base instructions + formatted memory. Greeting adapts: returning callers are greeted by name and may be gently asked about open threads.
2. **During call:** the Realtime model calls memory tools when the person shares something important; tools upsert quietly (the prompt says never to announce saving).
3. **Call end:** the collected transcript (from session `conversation_item_added` events) goes to `summarizer`; the summary row is written and extracted facts are merged (live-captured facts are not overwritten with empty values). Runs in `ctx.addShutdownCallback` with a timeout.

## Error handling
- Memory load fails → log, run the call without memory.
- Tool failure → return a soft error string to the model; never throw into the session.
- Summarizer failure/timeout → log; the call data already captured by live tools remains.

## Privacy
Grief data is sensitive. Demo stores plaintext in local Postgres. Production needs real auth, encryption at rest, retention/deletion policy, and consent — out of scope here.

## Testing
- Formatter: pure unit tests.
- Repository: integration tests against docker-compose Postgres (isolated test schema).
- Summarizer: unit test with a stubbed chat model.
- Tools: test with an in-memory fake repository.

## Out of scope
Real authentication, encryption, multi-user admin, web UI for memory, telephony.
