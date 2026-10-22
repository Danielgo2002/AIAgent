import { randomUUID } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import type { Env } from '../../config/env.js';

export interface SessionToken {
  token: string;
  url: string;
  room: string;
}

export class LivekitTokenService {
  constructor(private readonly env: Pick<Env, 'LIVEKIT_URL' | 'LIVEKIT_API_KEY' | 'LIVEKIT_API_SECRET'>) {}

  /** Creates a fresh room per session; the agent is auto-dispatched when the room is created. */
  async createSession(): Promise<SessionToken> {
    const room = `voice-${randomUUID()}`;
    const token = new AccessToken(this.env.LIVEKIT_API_KEY, this.env.LIVEKIT_API_SECRET, {
      identity: `user-${randomUUID()}`,
      ttl: '10m',
    });
    token.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true });
    return { token: await token.toJwt(), url: this.env.LIVEKIT_URL, room };
  }
}
