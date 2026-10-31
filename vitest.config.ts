import { defineConfig } from 'vitest/config';

// One project per workspace for now: the pure simulation core. The server and the
// PWA get their own entries in `projects` when they exist.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*-test.ts'],
  },
});
