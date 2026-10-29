import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AgentEventSource } from '../../events/agent-events.js';
import type { MemoryRepository } from '../../memory/types.js';
import { isValidAdminToken } from '../auth.js';

const HEARTBEAT_MS = 25_000;

const listQuery = z.object({
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const idParams = z.object({ id: z.string().uuid() });

export interface AdminRoutesOptions {
  repo: MemoryRepository;
  events: AgentEventSource;
  token: string;
  demoUserId: string;
}

/** Everything under /api here requires the admin token. */
export const adminRoutes =
  ({ repo, events, token, demoUserId }: AdminRoutesOptions): FastifyPluginAsync =>
  async (app) => {
    app.addHook('onRequest', async (req, reply) => {
      if (!isValidAdminToken(req.headers.authorization, token)) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
    });

    app.get('/api/users', async (req, reply) => {
      const query = listQuery.safeParse(req.query);
      if (!query.success) return reply.code(400).send({ error: 'bad query' });
      const users = await repo.listUsers(query.data);
      return users.map((u) => ({ ...u, isDemo: u.id === demoUserId }));
    });

    app.get('/api/users/:id/memory', async (req, reply) => {
      const params = idParams.safeParse(req.params);
      if (!params.success) return reply.code(400).send({ error: 'bad id' });
      const memory = await repo.findMemory(params.data.id);
      return memory ?? reply.code(404).send({ error: 'not found' });
    });

    app.delete('/api/users/:id', async (req, reply) => {
      const params = idParams.safeParse(req.params);
      if (!params.success) return reply.code(400).send({ error: 'bad id' });
      const removed = await repo.deleteUser(params.data.id);
      return reply.code(removed ? 204 : 404).send();
    });

    app.get('/api/events', (req, reply) => {
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write(': connected\n\n');
      const unsubscribe = events.subscribe((event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
      const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
      req.raw.on('close', () => {
        clearInterval(beat);
        unsubscribe();
      });
    });
  };
