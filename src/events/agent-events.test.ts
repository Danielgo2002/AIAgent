import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../memory/db.js';
import { TEST_DATABASE_URL } from '../memory/test-support.js';
import { AgentEventListener, notifyAgentEvent, parseAgentEvent, shrinkEvent, type AgentEvent } from './agent-events.js';

const event = (over: Partial<AgentEvent> = {}): AgentEvent => ({
  userId: '00000000-0000-4000-8000-000000000001',
  kind: 'memory',
  tool: 'remember_deceased',
  input: { name: 'דוד' },
  at: new Date().toISOString(),
  ...over,
});

describe('parseAgentEvent', () => {
  it('parses a valid payload and rejects garbage', () => {
    expect(parseAgentEvent(JSON.stringify(event()))?.tool).toBe('remember_deceased');
    expect(parseAgentEvent('not json')).toBeNull();
    expect(parseAgentEvent(JSON.stringify({ kind: 'memory' }))).toBeNull();
  });
});

describe('shrinkEvent', () => {
  it('keeps small events and replaces oversized inputs', () => {
    expect(shrinkEvent(event()).input).toEqual({ name: 'דוד' });
    const big = shrinkEvent(event({ input: { text: 'א'.repeat(20_000) } }));
    expect(big.input).toEqual({ truncated: true });
    expect(Buffer.byteLength(JSON.stringify(big))).toBeLessThan(8000);
  });
});

describe('notify -> listener round trip', () => {
  const { db, close } = createDb(TEST_DATABASE_URL);
  afterAll(async () => close());

  it('delivers a notified event to a subscriber', async () => {
    const listener = new AgentEventListener(TEST_DATABASE_URL);
    await listener.start();
    try {
      const received = new Promise<AgentEvent>((resolve) => listener.subscribe(resolve));
      await notifyAgentEvent(db, event({ kind: 'call_started', tool: undefined, input: undefined }));
      expect((await received).kind).toBe('call_started');
    } finally {
      await listener.stop();
    }
  });

  it('stops delivering after unsubscribe', async () => {
    const listener = new AgentEventListener(TEST_DATABASE_URL);
    await listener.start();
    try {
      const seen: AgentEvent[] = [];
      const off = listener.subscribe((e) => seen.push(e));
      off();
      await notifyAgentEvent(db, event());
      await new Promise((r) => setTimeout(r, 300));
      expect(seen).toHaveLength(0);
    } finally {
      await listener.stop();
    }
  });
});
