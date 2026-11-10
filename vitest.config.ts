import { defineConfig } from 'vitest/config';

// The core and the server share one project. The PWA is render-only and has no
// unit tests yet, so it stays out until a pure helper is worth testing here.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*-test.ts', 'apps/*/test/**/*-test.ts'],
    // The Postgres suites share one database and the town fixtures reset its
    // sequences; running files one at a time keeps them from truncating each
    // other's towns mid-test.
    fileParallelism: false,
    maxWorkers: 1,
  },
});
