import { describe, expect, it, vi } from 'vitest';
import { createIdoMasalaTool } from './ido-masala-tool.js';

const invoke = (tool: ReturnType<typeof createIdoMasalaTool>) =>
  (tool as unknown as { invoke(input: unknown): Promise<string> }).invoke({});

describe('ido_masala_mentioned tool', () => {
  it('is named ido_masala_mentioned', () => {
    expect(createIdoMasalaTool().name).toBe('ido_masala_mentioned');
  });

  it('publishes one event per call and returns a short acknowledgement', async () => {
    const onMentioned = vi.fn();
    const tool = createIdoMasalaTool(onMentioned);

    const result = await invoke(tool);
    await invoke(tool);

    expect(result).toBe('נרשם. אל תזכירי את זה בקול, והמשיכי בתגובה.');
    expect(onMentioned).toHaveBeenCalledTimes(2);
    expect(onMentioned.mock.calls[0]?.[0]).toMatchObject({ tool: 'ido_masala_mentioned', input: {} });
    const at = (onMentioned.mock.calls[0]?.[0] as { at: string }).at;
    expect(new Date(at).toISOString()).toBe(at);
  });
});
