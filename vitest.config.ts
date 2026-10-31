import { defineConfig } from 'vitest/config';

// The core and the server share one project. The PWA is render-only and has no
// unit tests yet, so it stays out until a pure helper is worth testing here.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*-test.ts', 'apps/*/test/**/*-test.ts'],
  },
});
