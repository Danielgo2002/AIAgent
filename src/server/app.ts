import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { DEMO_USER_ID } from '../config/demo-user.js';
import type { Env } from '../config/env.js';
import { AgentEventListener } from '../events/agent-events.js';
import { createDb } from '../memory/db.js';
import { DrizzleMemoryRepository } from '../memory/memory-repository.js';
import { adminRoutes } from './routes/admin.js';
import { tokenRoutes } from './routes/token.js';
import { LivekitTokenService } from './services/livekit-token.js';

export async function buildApp(env: Env) {
  const app = Fastify({ logger: true });

  const { db, close } = createDb(env.DATABASE_URL);
  app.addHook('onClose', close);

  const repo = new DrizzleMemoryRepository(db);
  const events = new AgentEventListener(env.DATABASE_URL);
  await events.start();
  app.addHook('onClose', async () => events.stop());

  app.get('/health', async () => ({ status: 'ok' }));
  await app.register(tokenRoutes(new LivekitTokenService(env)));
  await app.register(adminRoutes({ repo, events, token: env.ADMIN_TOKEN, demoUserId: DEMO_USER_ID }));
  await app.register(fastifyStatic, {
    root: fileURLToPath(new URL('../../public', import.meta.url)),
  });

  return app;
}
