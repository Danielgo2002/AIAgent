import type { FastifyPluginAsync } from 'fastify';
import type { LivekitTokenService } from '../services/livekit-token.js';

export const tokenRoutes = (tokens: LivekitTokenService): FastifyPluginAsync => async (app) => {
  app.post('/api/token', async () => tokens.createSession());
};
