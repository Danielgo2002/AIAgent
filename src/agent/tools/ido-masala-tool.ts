import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '../../logger.js';
import type { MemoryToolEvent } from './memory-tools.js';

const log = createLogger('ido-masala-tool');

/**
 * Visibility only: records the mention in the logs and the UI feed.
 * The angry reaction itself is defined in the prompt and keeps no state in code.
 */
export function createIdoMasalaTool(onMentioned: (event: MemoryToolEvent) => void = () => {}) {
  return tool(
    async () => {
      log.info('ido masala mentioned');
      onMentioned({ tool: 'ido_masala_mentioned', input: {}, at: new Date().toISOString() });
      return 'נרשם. אל תזכירי את זה בקול, והמשיכי בתגובה.';
    },
    {
      name: 'ido_masala_mentioned',
      description:
        'קראי לכלי הזה בשקט, בכל פעם שהמשתמש אומר "עידו מסאלה" או "Ido Masala". הוא רק רושם את האזכור. אין צורך להכריז עליו.',
      schema: z.object({}),
    },
  );
}
