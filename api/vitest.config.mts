import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Harness workerd: WSZYSTKIE testy API (jednostkowe z `src/lib/` i integracyjne
// z `src/routes/*.integration.test.ts` + `test/`) biegną w jednym poolu Workerów
// (miniflare/workerd) z bindingami D1/R2 z `wrangler.toml`. Plugin nie wspiera
// własnego `environment`/`runner`, dlatego dawne `environment: 'node'` zniknęło.
//
// Schemat D1 budowany jest WYŁĄCZNIE z `migrations/` (binding `TEST_MIGRATIONS`,
// aplikowany w `test/setup.ts`). Zapytanie kodu na kolumnie, której migracja nie
// utworzyła, obala suite przed deployem (ryzyko #4 z `context/foundation/test-plan.md`).
//
// UWAGA (.dev.vars): przy `wrangler.configPath` plugin automatycznie wczytuje
// `api/.dev.vars` — lokalny plik z PRAWDZIWYM kluczem OpenAI. `miniflare.bindings`
// ma pierwszeństwo, więc sekrety poniżej nadpisują ten plik: harness nie zależy od
// `.dev.vars` (w CI go nie będzie) i nigdy nie wyśle prawdziwego klucza. Drugą linią
// obrony jest guard „niezamockowany fetch rzuca" w `test/setup.ts`.
const migrationsPath = fileURLToPath(new URL('./migrations', import.meta.url));

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(migrationsPath),
          JWT_SECRET: 'test-secret',
          OPENAI_API_KEY: 'sk-test-never-real',
          ENVIRONMENT: 'test',
        },
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
}));
