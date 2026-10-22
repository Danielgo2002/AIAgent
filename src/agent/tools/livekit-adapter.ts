import { llm } from '@livekit/agents';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { ZodObject, ZodRawShape } from 'zod';

/** Exposes LangChain tools to the LiveKit agent, keeping LangChain as the tool harness. */
export function toLivekitTools(tools: StructuredToolInterface[]): llm.ToolContextLike {
  return Object.fromEntries(
    tools.map((lcTool) => [
      lcTool.name,
      llm.tool({
        description: lcTool.description,
        parameters: lcTool.schema as ZodObject<ZodRawShape>,
        execute: async (args) => lcTool.invoke(args),
      }),
    ]),
  );
}
