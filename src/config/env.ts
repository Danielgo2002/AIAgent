import { z } from 'zod';

const schema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  PHONE_HASH_KEY: z.string().min(32),
  PHONE_AUDIO_CLEANUP: z.enum(['none', 'openai', 'bvc']).default('none'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1).default('postgres://postgres:postgres@localhost:5433/podcusts'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const fields = Object.keys(result.error.flatten().fieldErrors).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  return result.data;
}
