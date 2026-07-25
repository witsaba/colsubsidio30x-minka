import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// Design §11. The suite never boots Astro: every module under test is either a
// DOM-free TypeScript module or a Preact component, so the plain Vite + Preact
// preset is enough and keeps the TDD cycle fast.
export default defineConfig({
  plugins: [preact()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
