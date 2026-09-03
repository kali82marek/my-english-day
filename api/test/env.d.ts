/**
 * Typy środowiska testowego. `env` z `cloudflare:workers` ma kształt `Cloudflare.Env`
 * (globalny interfejs z `@cloudflare/workers-types`, przewidziany do scalania
 * deklaracji); tu scalamy go z `Bindings` aplikacji i bindingiem testowym
 * `TEST_MIGRATIONS` z `vitest.config.mts`. Plik jest modułem (importy typów), więc
 * augmentacja idzie przez `declare global` — `extends` w interfejsie wymaga
 * identyfikatora, nie wyrażenia `import()` (TS2499).
 * `worker-configuration.d.ts` (`wrangler types`) nie jest potrzebny.
 */
import type { D1Migration } from 'cloudflare:test';
import type { Bindings } from '../src/types';

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
