import { defineConfig } from 'vitest/config';

// The core and the server share one project for now. The PWA gets its own entry
// in `projects` when it exists.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*-test.ts', 'apps/*/test/**/*-test.ts'],
  },
});
