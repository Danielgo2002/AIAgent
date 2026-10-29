import { describe, expect, it, vi } from 'vitest';
import type { MemoryRepository } from '../../memory/types.js';
import { createMemoryTools } from './memory-tools.js';

const fakeRepo = (overrides: Partial<MemoryRepository> = {}): MemoryRepository => ({
  loadMemory: vi.fn(),
  upsertDeceased: vi.fn().mockResolvedValue(undefined),
  updateUser: vi.fn().mockResolvedValue(undefined),
  saveCallSummary: vi.fn(),
  addCompanionNote: vi.fn().mockResolvedValue(undefined),
  findOrCreateUserByPhoneHash: vi.fn(),
  clearMemory: vi.fn(),
  listUsers: vi.fn(),
  findMemory: vi.fn(),
  deleteUser: vi.fn(),
  ...overrides,
});

const byName = (tools: ReturnType<typeof createMemoryTools>, name: string) =>
  tools.find((t) => t.name === name)! as unknown as { invoke(input: unknown): Promise<string> };

describe('memory tools', () => {
  it('remember_deceased saves through the repository for the bound user', async () => {
    const repo = fakeRepo();
    const tools = createMemoryTools(repo, 'user-1');

    const result = await byName(tools, 'remember_deceased').invoke({
      name: 'דוד',
      relationship: 'אב',
      dateOfDeath: '2025-03-01',
    });

    expect(repo.upsertDeceased).toHaveBeenCalledWith('user-1', {
      name: 'דוד',
      relationship: 'אב',
      dateOfDeath: '2025-03-01',
    });
    expect(result).toBe('נשמר');
  });

  it('remember_about_user saves profile updates', async () => {
    const repo = fakeRepo();
    const tools = createMemoryTools(repo, 'user-1');

    await byName(tools, 'remember_about_user').invoke({ firstName: 'נועה', gender: 'female' });

    expect(repo.updateUser).toHaveBeenCalledWith('user-1', { firstName: 'נועה', gender: 'female' });
  });

  it('returns a soft error instead of throwing when the database fails', async () => {
    const repo = fakeRepo({ upsertDeceased: vi.fn().mockRejectedValue(new Error('db down')) });
    const tools = createMemoryTools(repo, 'user-1');

    const result = await byName(tools, 'remember_deceased').invoke({ name: 'דוד' });

    expect(result).toContain('לא הצלחתי לשמור');
  });

  it('reports each successful save through onSaved, but not failures', async () => {
    const onSaved = vi.fn();
    const ok = createMemoryTools(fakeRepo(), 'user-1', onSaved);
    await byName(ok, 'remember_deceased').invoke({ name: 'דוד' });
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'remember_deceased', input: { name: 'דוד' } }),
    );

    onSaved.mockClear();
    const failing = createMemoryTools(
      fakeRepo({ updateUser: vi.fn().mockRejectedValue(new Error('db down')) }),
      'user-1',
      onSaved,
    );
    await byName(failing, 'remember_about_user').invoke({ firstName: 'נועה' });
    expect(onSaved).not.toHaveBeenCalled();
  });
});
