# Natural speech + "Ido Masala" reaction — Design Spec

Date: 2026-10-20
Status: Draft for review
Project: podcusts (Hebrew voice agent, LiveKit + OpenAI Realtime)

## 1. Goals

1. **Fluency.** The agent stops opening every reply with "אני שומע" and sounds like a person: varied openings, natural rhythm, short spoken sentences.
2. **"Ido Masala" reaction.** Whenever the user says "Ido Masala" or "עידו מסאלה", the agent reacts with a very angry, shouting outburst built around one fixed line, then calms down gradually over the next few turns and goes back to normal support.

Both changes are prompt and configuration work. No new tables and no new services.

## 2. Non-goals

- No change to the voice itself mid-call (OpenAI Realtime fixes the voice for the whole session). The anger comes from wording, pacing and instructions, not a different voice.
- No elaboration on what Ido Masala "did". The agent only says the scripted line.
- No keyword filter that rewrites or cancels model responses.
- No storing the mention in the user's memory.

## 3. Part A — Fluency

### 3.1 Cause

`BASE_INSTRUCTIONS` in `src/agent/instructions.ts` tells the model to "listen patiently, answer briefly and warmly" and to "reflect what was said" (לשקף). Short answers plus a reflection rule make the model open each turn with the same acknowledgement ("אני שומע"). The slash gender forms (`את/ה`, `ענה/י`) in the prompt also push the model toward stiff, written-style Hebrew. Nothing in the code adds the phrase.

### 3.2 Changes

1. **Rewrite the base prompt in natural spoken Hebrew.**
   - The agent has one fixed persona gender (feminine, matching the existing greeting prompts). It addresses the user in the gender stored in memory (`GENDER_LINE`), and in a neutral phrasing when unknown. No slash forms in the prompt.
   - Describe the way she talks: like a close, calm friend on the phone, short spoken sentences, contractions and everyday words, no formal or "therapist" phrasing.
2. **Ban stock openers explicitly.** A list of forbidden opening phrases: "אני שומע / שומעת", "אני מבין / מבינה", "אני כאן בשבילך", "תודה ששיתפת", "זה מובן". Rule: never start two consecutive replies with the same word, and never start a reply by repeating back what the user just said.
3. **Replace "reflect what was said" with concrete moves** the agent can choose between: answer directly, ask one small open question, share a brief natural reaction (a sigh, "וואו", "אוי"), stay quiet with a very short acknowledgement, or pick up a detail from earlier in the call.
4. **Length and rhythm.** One to three short sentences per turn, one question at most, no lists, no summaries of what the user said.
5. **Realtime settings** in `src/agent/main.ts`, to be verified against the installed `@livekit/agents-plugin-openai` before use:
   - try a more natural voice than `coral` (candidates `marin` or `cedar`) if the plugin version accepts them;
   - set `temperature` around 0.9 for more varied wording;
   - keep `semantic_vad`, and test `eagerness: 'medium'` so the agent does not cut in too early.
6. **Greeting prompts** (`FIRST_GREETING`, `RETURNING_GREETING`) follow the same rules, and ask for a different, natural greeting rather than a fixed phrase.

### 3.3 Acceptance

- In a 10-turn test call, no reply starts with a banned opener and no two consecutive replies share the same first word.
- Replies are at most three short sentences.
- The agent still saves memory silently and keeps the safety rule (ער"ן 1201, 100/101).

## 4. Part B — "Ido Masala" reaction

### 4.1 Trigger

The user says "Ido Masala" or "עידו מסאלה" (the model also covers transcription variants such as "עידו מסלה" or "אידו מסאלה"). The name **"עידו" on its own never triggers it**, because the demo user is also called Ido.

### 4.2 Behavior

On every mention, even if it already happened earlier in the call, the agent runs the **anger arc**:

| Turn after the mention | Behavior |
|---|---|
| 1 (the reply to the mention) | Furious and shouting. Loud, fast, short bursts and interruptions of her own sentences. Says the fixed line. |
| 2 | Still furious, but in full sentences, a little lower. May repeat part of the line. |
| 3 | Irritated and heavy, speaking low. Short, tense sentences. |
| 4 | Breathes out, calms, and gently returns to normal support, without apologizing at length. |

A new mention restarts the arc at turn 1.

**Fixed line (Hebrew, from the user's English wording):**
"מה שעידו מסאלה עשה זה ממש רע, ואף פעם לא נוכל לדבר על זה."
It is said in the first turn of the arc, at the peak of the anger, and may be repeated in the second turn. Nothing is added about what he did.

### 4.3 Guardrails

- Anger is aimed at the name and the situation, never at the user. No insults, no profanity, no threats, no mocking the user.
- The agent invents no details about the person or what he did.
- The arc stops immediately and the agent drops to a calm, supportive tone if the user sounds distressed, mentions the person they lost, signals a risk to life or self-harm, or asks her to stop. The safety rule in the base prompt always wins.
- If companion mode is active, the arc overrides it for its four turns; companion mode resumes afterwards unless one of the exit conditions above applies.
- The mention is **not** saved to memory: the prompt tells the agent not to call `remember_*` tools for it.

### 4.4 Implementation

- **Prompt only for behavior.** The whole arc, the fixed line and the guardrails live in `BASE_INSTRUCTIONS`, so the first reply is already angry. A tool call cannot change the instructions in time for the reply that triggered it, so state is not kept in code. The model counts turns from the conversation context.
- **One small tool, `ido_masala_mentioned`,** for visibility only: called silently at the mention, it logs `ido masala mentioned` and publishes a `memory`-topic event so the page shows it in the live feed. It returns an empty acknowledgement and changes no state. It is added to `createModeTools` or a sibling module with the same wiring as the companion tools.
- **Event type:** extend `MemoryToolEvent` with `ido_masala_mentioned`; add a Hebrew label in `public/client.js`.
- **Post-call summarizer:** its prompt is told to ignore the scripted reaction, so the call summary does not describe the outburst as part of the user's grief.

### 4.5 Limits to be aware of

- The anger intensity depends on the model following tone instructions; it will not always be identical, and it cannot be a different voice.
- Detection relies on the model hearing and understanding the name; a badly transcribed name may be missed. The log line from the tool shows how often it fires.
- Shouting at a grieving person is a deliberate product choice here. The guardrails in §4.3 keep it away from the user and make it stop when the user is in distress.

## 5. Testing

- **Unit tests** (`src/agent/instructions.test.ts`): the prompt contains the fixed line, the four-turn arc, the banned-opener list, the guardrails and the "do not save" rule; it contains no slash gender forms; the arc text is present with and without companion mode.
- **Tool test** (`mode-tools.test.ts` style): `ido_masala_mentioned` publishes exactly one event and changes no state.
- **Manual call script** (cannot be automated): (1) ten ordinary turns, check openers; (2) say "עידו מסאלה" and check the arc over the next four turns; (3) say it again mid-arc and check it restarts; (4) say "עידו" alone and check nothing fires; (5) say it, then say you are upset about your loss, and check the anger stops.
- **Log check:** after a call, `grep -a "ido masala"` in `/tmp/agent.log` matches the number of mentions.

## 6. Open items

- Confirm which of `marin` / `cedar` the installed plugin accepts, and whether `temperature` is exposed.
- The Hebrew translation of the line in §4.2 is mine; adjust if you want different wording.
