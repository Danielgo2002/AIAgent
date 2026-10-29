import { fileURLToPath } from 'node:url';
import { cli, defineAgent, ServerOptions, voice, type JobContext } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import * as noiseCancellation from '@livekit/noise-cancellation-node';
import { ParticipantKind } from '@livekit/rtc-node';
import { loadEnv } from '../config/env.js';
import { resolveUserId } from '../memory/caller-identity.js';
import { createDb } from '../memory/db.js';
import { formatMemory } from '../memory/memory-formatter.js';
import { DrizzleMemoryRepository } from '../memory/memory-repository.js';
import { createOpenAiAnalyzer, finalizeCall, type TranscriptLine } from '../memory/summarizer.js';
import { HebrewAssistant } from './assistant.js';
import { buildGreeting, buildInstructions } from './instructions.js';
import { createLogger } from '../logger.js';
import { createIdoMasalaTool, createMemoryTools, createModeTools, langchainTools, type ModeController } from './tools/index.js';
import type { MemoryToolEvent } from './tools/memory-tools.js';
import type { UserMemory } from '../memory/types.js';
import { buildTranscriptionPrompt } from './phone-profile.js';

const log = createLogger('agent');

const FINALIZE_TIMEOUT_MS = 30_000;
const MEMORY_EVENT_TOPIC = 'memory';

export default defineAgent({
  entry: async (ctx: JobContext) => {
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
    const isSip = participant.kind === ParticipantKind.SIP;
    const userId = await resolveUserId(
      { isSip, attributes: participant.attributes },
      repo,
      env.PHONE_HASH_KEY,
    );
    callLog.info({ anonymous: userId === null }, userId === null ? 'anonymous call' : 'call started');
    callLog.info({ isSip, cleanup: isSip ? env.PHONE_AUDIO_CLEANUP : 'n/a' }, 'channel profile');

    // A memory failure must never prevent the call from happening.
    let memory: UserMemory | null = null;
    let memoryBlock = '';
    if (userId) {
      const loadStarted = Date.now();
      try {
        memory = await repo.loadMemory(userId);
        memoryBlock = formatMemory(memory);
        callLog.info(
          { ms: Date.now() - loadStarted, deceased: memory.deceased.length, summaries: memory.recentSummaries.length, returning: memoryBlock !== '' },
          'memory loaded',
        );
      } catch (err) {
        callLog.error({ err }, 'failed to load user memory, continuing without it');
      }
    }

    const session = new voice.AgentSession({
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
    });

    const transcript: TranscriptLine[] = [];
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, ({ item }) => {
      if (item.type !== 'message') return;
      const text = item.textContent;
      if (text && (item.role === 'user' || item.role === 'assistant')) {
        transcript.push({ role: item.role, text });
        callLog.info({ role: item.role, text }, 'transcript');
      }
    });

    ctx.addShutdownCallback(async () => {
      callLog.info({ lines: transcript.length }, 'call ended, finalizing');
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
    });

    // Surface tool activity in the web UI; failures here must never affect the call.
    const publishEvent = (event: MemoryToolEvent) => {
      ctx.room.localParticipant
        ?.publishData(new TextEncoder().encode(JSON.stringify(event)), {
          reliable: true,
          topic: MEMORY_EVENT_TOPIC,
        })
        .then(() => callLog.info({ tool: event.tool }, 'memory event published to UI'))
        .catch((err) => callLog.error({ err }, 'failed to publish memory event'));
    };

    const modeController: ModeController = {
      setCompanionMode: async (on) => {
        await assistant.updateInstructions(buildInstructions(memoryBlock, on, isSip));
        callLog.info({ companionMode: on }, 'companion mode changed');
      },
    };

    const assistant = new HebrewAssistant(buildInstructions(memoryBlock, false, isSip), [
      ...langchainTools,
      ...(userId ? createMemoryTools(repo, userId, publishEvent) : []),
      ...createModeTools(modeController, publishEvent),
      createIdoMasalaTool(publishEvent),
    ]);

    await session.start({
      agent: assistant,
      room: ctx.room,
      ...(isSip && env.PHONE_AUDIO_CLEANUP === 'bvc'
        ? { inputOptions: { noiseCancellation: noiseCancellation.TelephonyBackgroundVoiceCancellation() } }
        : {}),
    });
    callLog.info('agent ready, greeting');
    session.generateReply({ instructions: buildGreeting(memoryBlock !== '') });
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
