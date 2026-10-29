# Phone quality and admin dashboard — Design Spec

Date: 2026-10-29
Status: Draft for review
Project: podcusts (Hebrew voice agent, LiveKit + OpenAI Realtime, Twilio phone line, per-caller memory)

Two parts, planned and implemented separately: **Part A** (phone sound and answers) and **Parts B + C** (live events from phone calls and a multi-user dashboard).

## 1. Problems

1. **Phone calls sound robotic and answer worse than the web.** In logged phone calls the transcripts are often garbled (for example "אתה הופך קורבן חבל ששרשרת נשתה?"). The model answers what it thinks it heard, and falls back to a generic empathy line. Phone audio reaches the agent as narrowband 8 kHz, far poorer than a browser microphone, and nothing cleans it up. One call also opened with the same greeting twice.
2. **The dashboard shows nothing during a phone call.** Live memory events travel as data messages inside the LiveKit room. The web page only receives them when it is a participant in that room; a phone call has no web page in it.
3. **The dashboard shows one fixed user** (the demo user), with no list, search or per-user view, and no protection although it will hold every caller's data.

## 2. Decisions (made with the product owner)

| Question | Decision |
|---|---|
| Dashboard access | Secret `ADMIN_TOKEN` in `.env`; data routes reject requests without it. |
| How callers are labelled | Name + last 4 digits of the number, e.g. "Daniel ••••9405". Only the last 4 digits are stored, in a new column; the full number is still never stored. |
| Delivery of live events | Postgres `LISTEN/NOTIFY` to a server-sent-events stream (no new infrastructure). |

## 3. Non-goals

- No change to PSTN audio quality at the carrier level; 8 kHz is a property of phone lines.
- No persistence of live events (the saved memory tables already hold the data).
- No user roles, accounts or login screens beyond the single admin token.
- No dashboard editing of memory fields (view, search, delete only).

## 4. Part A: phone sound and answers

### 4.1 Channel profile
`main.ts` already knows whether the participant is SIP (`isSip`). All changes below apply only to SIP callers; the web path is unchanged.

### 4.2 Clean the incoming audio
- **Preferred:** LiveKit telephony noise cancellation (`@livekit/noise-cancellation-node`, background-voice cancellation tuned for telephony) passed as `noiseCancellation` in the room input options of `session.start`. It is a LiveKit Cloud feature; **the plan requirement and cost must be confirmed before building on it.**
- **Fallback:** OpenAI `inputAudioNoiseReduction` on the RealtimeModel (`near_field` for a handset, compared with `far_field`).
- The implementation plan makes this a small, switchable setting, and picks the winner by the manual comparison in 4.7.

### 4.3 Help the transcriber
Pass a transcription prompt (if `InputAudioTranscription` in the installed plugin accepts `prompt`; verify) with vocabulary hints: the caller's first name, the deceased people's names from the loaded memory, "עידו מסאלה", and a few grief terms. Keep it short (under ~200 characters) and build it from the memory already loaded. Language stays `he`.

### 4.4 Stop the generic fallback
For SIP calls `buildInstructions` appends a phone block:
- The call is by phone and speech recognition may be wrong.
- If the words do not make sense or seem cut, ask the caller to repeat, naturally and briefly ("לא שמעתי טוב, תגידי שוב?"), instead of an empathy filler.
- Questions about the caller's own name or the deceased are answered directly from the memory block; if the memory has no answer, say so plainly.
- All existing rules (no stock openers, short replies, safety, Ido Masala) still apply.

### 4.5 Voice
On a real call, compare `marin` and `cedar` and output `speed` 0.95 to 1.0. Pick by listening. Accept that some phone-line character remains.

### 4.6 Duplicate greeting
Reproduce and fix the doubled greeting. First suspects: `generateReply` being triggered twice per job, or two jobs for one call. The fix must be covered by a log-based check (one `agent ready, greeting` line per call).

### 4.7 Measuring
A fixed script of 10 utterances called in before and after, including "מה השם שלי?" and "איך קראו לנפטר?". Record per run: how many were transcribed correctly, how many answered correctly. The change ships only if it is better than the baseline, and the numbers go in the commit or plan notes.

## 5. Part B: live events from phone calls

### 5.1 Event flow
- The agent's `publishEvent` keeps sending the in-room data message (web) **and** also calls `pg_notify('agent_events', payload)` with `{ userId, tool, input, at }`.
- The agent also emits `call_started` and `call_ended` events (with `userId`, no phone data) so the dashboard can show "on call now". Anonymous calls emit nothing because they have no user.
- `NOTIFY` payloads are limited to 8000 bytes; inputs are truncated to stay below it.
- Failures to notify are logged and never affect the call.

### 5.2 Server stream
`GET /api/events` is a server-sent-events stream (token required). One dedicated `pg` connection does `LISTEN agent_events` and fans out to connected dashboards. It sends a heartbeat comment every 25 seconds, reconnects the listener on error, and closes cleanly when the client disconnects. The browser reads it with `fetch` and a stream reader so it can send the `Authorization` header (`EventSource` cannot).

## 6. Part C: dashboard

### 6.1 Data
One migration adds `users.phone_last4 text` (nullable). `findOrCreateUserByPhoneHash(hash, last4)` sets it when creating a user, and fills it for an existing user whose value is null. `resolveUserId` passes the last 4 digits of the normalized number. Existing phone users gain it on their next call.

### 6.2 API (all require `Authorization: Bearer <ADMIN_TOKEN>`)
| Route | Purpose |
|---|---|
| `GET /api/users?q=&limit=` | Users with `id`, `firstName`, `phoneLast4`, `lastCallAt`, `callCount`, counts. `q` matches first name, last 4 digits and deceased names (`ILIKE`, user input escaped for `%`, `_`, `\`). Default limit 50, max 200. |
| `GET /api/users/:id/memory` | Full memory for one user, with **all** call summaries. Read-only: unknown id returns 404 and creates nothing. |
| `DELETE /api/users/:id` | Deletes the user and, by cascade, all their data. Returns 204. |
| `GET /api/events` | Live stream from 5.2. |

Repository additions: `listUsers`, `findMemory` (read-only), `deleteUser`. The existing `loadMemory` stays for the agent, which wants the create-if-missing behavior. The old `/api/memory` routes stay for the web demo user and are also behind the token.

The token is compared in constant time (`crypto.timingSafeEqual` on equal-length digests). `ADMIN_TOKEN` is required in `loadEnv` (min 16 characters) and never logged.

### 6.3 Page
- **Layout:** user list and search box on one side, the selected user's data on the other; stacks on narrow screens. Right-to-left, Hebrew.
- **User list:** each row shows "name ••••last4" (or "מתקשר/ת לא מזוהה ••••last4" before a name is learned), last call time, and an "בשיחה עכשיו" badge from live events. Search is debounced.
- **User view:** profile, deceased, companion preferences, call summaries; each in a collapsible section, with open/closed state remembered per section.
- **Live feed:** newest events first, with a toggle between "this user" and "everyone". New events for the selected user refresh that user's data.
- **Token:** asked once, kept in `sessionStorage`, cleared on a 401 with a prompt to re-enter.
- **Web call:** the "start conversation" button stays; the web user appears as "Demo (web)".
- **Rendering:** all stored text is inserted with `textContent` only.
- **Code layout:** `client.js` is split into focused modules (web call, API client, dashboard rendering) so each stays small.
- **Delete:** a button on the user view that needs the user to type the user's label to confirm.

## 7. Privacy and safety

1. Every data route and the live stream require the token; the static page itself shows no data without it.
2. Only the last 4 digits of numbers are stored in addition to the keyed hash; neither appears in logs or events beyond the label shown in the authenticated dashboard.
3. Deleting a user is irreversible; tests only delete users they created in the test database, and nothing is deleted from the real database without the owner's explicit action in the dashboard.
4. The server still listens on all interfaces; the token is what protects it. If hosted later, serve it behind HTTPS so the token is not sent in clear text.

## 8. Testing

- **Unit:** token check (missing, wrong, right, different length); search escaping; `buildInstructions` includes the phone block for SIP and not for web; transcription hint built from memory and bounded in length; notify payload size and truncation.
- **Repository:** `listUsers` search by name, last 4, deceased name; `findMemory` returns null for unknown id and creates no row; `deleteUser` cascades; `findOrCreateUserByPhoneHash` fills `phone_last4` once.
- **Integration:** `LISTEN/NOTIFY` round trip against the test database (notify, receive on the listener).
- **Manual:** the 10-utterance phone script before and after Part A; a phone call with the dashboard open shows "on call now" and live events; search finds a user by name and by last 4 digits; collapse state persists across reload.

## 9. Open items

- Confirm LiveKit noise cancellation availability and cost on the current Cloud plan.
- Confirm that the installed OpenAI plugin accepts a transcription `prompt`.
- Find the cause of the duplicate greeting.
