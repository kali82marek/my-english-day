import { defineConfig } from 'vitest/config';

// Rdzeń auth (PBKDF2 via Web Crypto, hono/jwt) używa wyłącznie Web Crypto API,
// dostępnego globalnie w Node 20+. Wystarczy zwykły harness `node` — bez
// pełnego poola Workerów (miniflare), który nie jest potrzebny dla czystych
// prymitywów bez bindingów D1.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
