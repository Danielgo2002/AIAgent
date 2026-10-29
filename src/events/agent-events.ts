import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { z } from 'zod';
import type { Db } from '../memory/db.js';
import { createLogger } from '../logger.js';

const log = createLogger('agent-events');

export const AGENT_EVENTS_CHANNEL = 'agent_events';
const MAX_PAYLOAD_BYTES = 7500;
const RECONNECT_DELAY_MS = 1000;

const eventSchema = z.object({
  userId: z.string().min(1),
  kind: z.enum(['memory', 'call_started', 'call_ended']),
  tool: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  at: z.string(),
});
export type AgentEvent = z.infer<typeof eventSchema>;

export function parseAgentEvent(raw: string): AgentEvent | null {
  try {
    const result = eventSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Postgres limits NOTIFY payloads to 8000 bytes; drop the input when an event would not fit. */
export function shrinkEvent(event: AgentEvent): AgentEvent {
  if (Buffer.byteLength(JSON.stringify(event)) <= MAX_PAYLOAD_BYTES) return event;
  return { ...event, input: { truncated: true } };
}

export async function notifyAgentEvent(db: Db, event: AgentEvent): Promise<void> {
  const payload = JSON.stringify(shrinkEvent(event));
  await db.execute(sql`select pg_notify(${AGENT_EVENTS_CHANNEL}, ${payload})`);
}

export interface AgentEventSource {
  subscribe(handler: (event: AgentEvent) => void): () => void;
}

/** One dedicated connection that LISTENs for agent events and fans them out to subscribers. */
export class AgentEventListener implements AgentEventSource {
  private client: Client | null = null;
  private readonly handlers = new Set<(event: AgentEvent) => void>();
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly connectionString: string) {}

  subscribe(handler: (event: AgentEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const client = this.client;
    this.client = null;
    await client?.end().catch(() => {});
  }

  private async connect(): Promise<void> {
    const client = new Client({ connectionString: this.connectionString });
    client.on('notification', (msg) => {
      const event = msg.payload ? parseAgentEvent(msg.payload) : null;
      if (!event) return;
      for (const handler of this.handlers) {
        try {
          handler(event);
        } catch (err) {
          log.error({ err }, 'event handler failed');
        }
      }
    });
    client.on('error', (err) => {
      log.error({ err }, 'listener connection error');
      this.scheduleReconnect();
    });
    client.on('end', () => this.scheduleReconnect());
    await client.connect();
    await client.query(`LISTEN ${AGENT_EVENTS_CHANNEL}`);
    if (this.stopped) {
      // stop() ran while we were connecting; do not leave this connection open.
      await client.end().catch(() => {});
      return;
    }
    this.client = client;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.client = null;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.connect().catch((err) => {
        log.error({ err }, 'listener reconnect failed');
        this.scheduleReconnect();
      });
    }, RECONNECT_DELAY_MS);
  }
}
