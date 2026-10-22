import { pino } from 'pino';

export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

/** Logger tagged with the part of the system it belongs to, e.g. `memory`, `agent`. */
export const createLogger = (component: string) => logger.child({ component });
