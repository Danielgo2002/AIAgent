import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const currentTime = tool(
  async ({ timeZone }) =>
    new Intl.DateTimeFormat('he-IL', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone,
    }).format(new Date()),
  {
    name: 'current_time',
    description: 'מחזיר את התאריך והשעה הנוכחיים באזור זמן נתון.',
    schema: z.object({
      timeZone: z.string().default('Asia/Jerusalem').describe('IANA time zone, e.g. Asia/Jerusalem'),
    }),
  },
);
