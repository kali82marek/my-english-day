/**
 * Wspólny kształt środowiska Hono dla całej aplikacji Workera.
 * `Bindings` = sekrety/bindingi z `wrangler.toml`; `Variables` = wartości
 * wstrzykiwane do kontekstu przez middleware (np. `userId` po weryfikacji JWT).
 */

export type Bindings = {
  DB: D1Database;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  AUDIO_BUCKET: R2Bucket;
  OPENAI_API_KEY: string;
};

export type Variables = {
  userId: string;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};
