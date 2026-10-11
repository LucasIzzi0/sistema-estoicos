import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Los tests de integración comparten una base y un Redis reales: van de a uno.
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
