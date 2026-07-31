import { defineConfig } from 'vitest/config';

// Unit tests only. These import straight from src/ and api/ and must stay
// dependency-light and fast — the browser-level behaviour lives in
// tests/e2e (Playwright). No jsdom: the few modules that touch
// localStorage stub `window` themselves, which keeps the install small.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    reporters: 'default',
  },
});
