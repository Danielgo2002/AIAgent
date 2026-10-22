import { describe, expect, it, vi } from 'vitest';
import { createModeTools } from './mode-tools.js';

const byName = (tools: ReturnType<typeof createModeTools>, name: string) =>
  tools.find((t) => t.name === name) as unknown as { invoke(input: unknown): Promise<string> };

describe('mode tools', () => {
  it('start/stop switch the controller and report an event', async () => {
    const controller = { setCompanionMode: vi.fn().mockResolvedValue(undefined) };
    const onChanged = vi.fn();
    const tools = createModeTools(controller, onChanged);

    await byName(tools, 'start_companion_mode').invoke({});
    await byName(tools, 'stop_companion_mode').invoke({});

    expect(controller.setCompanionMode.mock.calls).toEqual([[true], [false]]);
    expect(onChanged.mock.calls.map(([e]) => e.tool)).toEqual(['start_companion_mode', 'stop_companion_mode']);
  });

  it('returns a soft error and no event when the switch fails', async () => {
    const controller = { setCompanionMode: vi.fn().mockRejectedValue(new Error('boom')) };
    const onChanged = vi.fn();

    const result = await byName(createModeTools(controller, onChanged), 'start_companion_mode').invoke({});

    expect(result).toContain('לא הצלחתי');
    expect(onChanged).not.toHaveBeenCalled();
  });
});
