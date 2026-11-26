import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}', 'demo/src/**/*.test.tsx'],
    // Keep worker start-up reliable on loaded hosts: few workers, in-process
    // threads (cheaper to spawn than forks), and generous teardown time.
    pool: 'threads',
    maxWorkers: 2,
    teardownTimeout: 30000,
  },
});
