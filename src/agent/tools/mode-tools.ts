import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '../../logger.js';
import type { MemoryToolEvent } from './memory-tools.js';

const log = createLogger('mode-tools');

export interface ModeController {
  setCompanionMode(on: boolean): Promise<void>;
}

/** Lets the model switch the optional companion mode, but only on the user's explicit request. */
export function createModeTools(
  controller: ModeController,
  onChanged: (event: MemoryToolEvent) => void = () => {},
) {
  const change = async (on: boolean) => {
    const name = on ? 'start_companion_mode' : 'stop_companion_mode';
    log.info({ tool: name }, 'mode tool called');
    try {
      await controller.setCompanionMode(on);
      onChanged({ tool: name, input: {}, at: new Date().toISOString() });
      return on ? 'מצב חברותי הופעל' : 'חזרת למצב תמיכה רגיל';
    } catch (err) {
      log.error({ err, tool: name }, 'mode change failed');
      return 'לא הצלחתי להחליף מצב. המשיכי בשיחה כרגיל.';
    }
  };

  const start = tool(async () => change(true), {
    name: 'start_companion_mode',
    description:
      'הפעילי את המצב החברותי (רומנטי-קליל, בלי תוכן מיני) רק אם המשתמש ביקש זאת במפורש, למשל "תפלרטטי איתי" או "hit on me". לעולם לא ביוזמתך.',
    schema: z.object({}),
  });

  const stop = tool(async () => change(false), {
    name: 'stop_companion_mode',
    description:
      'חזרי למצב תמיכה רגיל: כשהמשתמש מבקש להפסיק, כשיש סימן למצוקה, או כשעולה בשיחה אדם יקר שנפטר.',
    schema: z.object({}),
  });

  return [start, stop];
}
