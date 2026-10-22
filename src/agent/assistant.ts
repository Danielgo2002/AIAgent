import { voice } from '@livekit/agents';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { toLivekitTools } from './tools/livekit-adapter.js';

export class HebrewAssistant extends voice.Agent {
  constructor(instructions: string, tools: StructuredToolInterface[]) {
    super({ instructions, tools: toLivekitTools(tools) });
  }
}
