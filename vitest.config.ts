import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { env: { LOG_LEVEL: 'silent' }, globalSetup: ['tests/global-setup.ts'], include: ['src/**/*.test.ts'] },
});
