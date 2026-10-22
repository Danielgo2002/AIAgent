import type { FastifyPluginAsync } from 'fastify';
import type { MemoryRepository } from '../../memory/types.js';

export const memoryRoutes =
  (repo: MemoryRepository, userId: string): FastifyPluginAsync =>
  async (app) => {
    app.get('/api/memory', async () => repo.loadMemory(userId));

    app.delete('/api/memory', async (_req, reply) => {
      await repo.clearMemory(userId);
      return reply.code(204).send();
    });
  };
