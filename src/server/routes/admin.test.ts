import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AgentEventSource } from '../../events/agent-events.js';
import type { MemoryRepository } from '../../memory/types.js';
import { adminRoutes } from './admin.js';

const TOKEN = 't'.repeat(32);
const auth = { authorization: `Bearer ${TOKEN}` };
const UID = '11111111-1111-4111-8111-111111111111';

const build = async (repo: Partial<MemoryRepository>) => {
  const app = Fastify();
  const events: AgentEventSource = { subscribe: () => () => {} };
  await app.register(adminRoutes({ repo: repo as MemoryRepository, events, token: TOKEN, demoUserId: UID }));
  await app.ready();
  return app;
};

describe('admin routes', () => {
  it('rejects requests without a valid token', async () => {
    const app = await build({ listUsers: vi.fn() });
    expect((await app.inject({ method: 'GET', url: '/api/users' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/users', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/events' })).statusCode).toBe(401);
  });

  it('lists users and flags the demo user', async () => {
    const listUsers = vi.fn().mockResolvedValue([
      { id: UID, firstName: 'דניאל', phoneLast4: null, lastCallAt: null, callCount: 0, deceasedCount: 0 },
    ]);
    const res = await (await build({ listUsers })).inject({ method: 'GET', url: '/api/users?q=%D7%93&limit=10', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(listUsers).toHaveBeenCalledWith({ q: 'ד', limit: 10 });
    expect(res.json()[0]).toMatchObject({ id: UID, isDemo: true });
  });

  it('returns 400 for a malformed id and 404 for an unknown user', async () => {
    const app = await build({ findMemory: vi.fn().mockResolvedValue(null) });
    expect((await app.inject({ method: 'GET', url: '/api/users/not-a-uuid/memory', headers: auth })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/api/users/${UID}/memory`, headers: auth })).statusCode).toBe(404);
  });

  it('accepts the demo user id, which has no standard uuid version digit', async () => {
    const demo = '00000000-0000-0000-0000-000000000001';
    const findMemory = vi.fn().mockResolvedValue({ user: { id: demo }, deceased: [], companion: [], recentSummaries: [] });
    const res = await (await build({ findMemory })).inject({ method: 'GET', url: `/api/users/${demo}/memory`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(findMemory).toHaveBeenCalledWith(demo);
  });

  it('deletes a user (204) and reports 404 when it did not exist', async () => {
    const deleteUser = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const app = await build({ deleteUser });
    expect((await app.inject({ method: 'DELETE', url: `/api/users/${UID}`, headers: auth })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/users/${UID}`, headers: auth })).statusCode).toBe(404);
  });
});
