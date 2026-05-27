---
project: my-english-day
researched_at: 2026-05-27
recommended_platform: Cloudflare Workers + Pages
runner_up: Railway
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Expo (React Native) — mobile; backend TBD (Hono / itty-router on Workers)
  runtime: V8 isolates (Cloudflare Workers) + Node.js (Expo build)
---

## Recommendation

**Deploy on Cloudflare Workers + Pages.**

Cloudflare uzyskał najwyższy score (5/5) we wszystkich pięciu kryteriach agent-friendly: pełne CLI (`wrangler`), managed serverless, agent-readable docs (`llms.txt` + GitHub markdown), stabilne deploy API, i najrozbudowanszy MCP server (14 modułów). Hojny free tier (100k req/dzień, D1 500MB, R2 10GB) pokrywa potrzeby MVP bez kosztów. Brak wymogu persistent connections (potwierdzony w wywiadzie) eliminuje jedyne ograniczenie serverless. Priorytet DX jest adresowany przez dojrzałe narzędzia i dokumentację, choć V8 isolates wymagają adaptacji wzorców (Hono zamiast Express).

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP/Integration | Łącznie |
|---|---|---|---|---|---|---|
| **Cloudflare** | Pass | Pass | Pass | Pass | Pass | **5/5** |
| **Vercel** | Pass | Pass | Pass | Pass | Pass | **5/5** |
| **Railway** | Partial | Pass | Pass | Partial | Partial | **3.5/5** |
| **Netlify** | Partial | Pass | Pass | Partial | Pass | **3.5/5** |
| **Fly.io** | Pass | Partial | Partial | Pass | Fail | **3/5** |
| **Render** | Partial | Pass | Partial | Partial | Partial | **3/5** |

**Detale scoringu per platforma:**

- **Cloudflare** — `wrangler` pokrywa deploy, rollback, tail, secrets. Workers to w pełni managed serverless (V8 isolates). Docs z `llms.txt` i źródłem na GitHubie. `wrangler deploy` daje deterministic output. 14 MCP serwerów pokrywa Workers, D1, R2, logi, analytics.
- **Vercel** — `vercel` CLI z deploy/rollback/logs. Serverless functions GA. `llms.txt` i `llms-full.txt` dostępne. MCP GA (read-only). Jednak: Vercel Postgres/KV deprecated, Blob w beta, 60s timeout na Hobby, logi 1h.
- **Railway** — `railway up` deployuje, `railway logs` streamuje, ale brak CLI rollback. Kontenery = managed. `llms-full.txt` dostępny. Deploy API bez rollbacku = Partial. MCP unverified (404 na docs).
- **Netlify** — `netlify deploy` OK, ale rollback tylko przez UI. Serverless functions GA. `llms.txt` dostępny. MCP GA. Jednak: 6MB payload limit, 60s timeout, brak persistent processes.
- **Fly.io** — `flyctl` pokrywa deploy/logs/secrets, brak dedykowanego rollback. Kontenery (Dockerfile wymagany) = Partial managed. Brak `llms.txt`. Brak MCP.
- **Render** — CLI v2.18.0 bez rollback command. Managed hosting GA. Brak `llms.txt`. MCP v0.3.0 (early). Free Postgres wygasa po 30 dniach.

### Shortlisted Platforms

#### 1. Cloudflare Workers + Pages (Recommended)

Najwyższy score w kryteriach agent-friendly przy zerowym koszcie MVP. D1 (SQLite serverless) pokrywa bazę fiszek, R2 pokrywa storage audio, Queues umożliwiają asynchroniczne generowanie fiszek. Cały ekosystem GA bez beta dependencies. Free tier: 100k req/dzień, 10 baz D1 po 500MB, 10GB R2, 10k Queues ops/dzień. MCP z 14 modułami daje agentowi strukturalny dostęp do logów, analytics i deploymentów. Główny trade-off: V8 isolates zamiast pełnego Node.js — wymaga Workers-compatible frameworka (Hono) i unikania native npm modules.

#### 2. Railway (Runner-up)

Najlepszy DX dla pełnego Node.js — `railway up` deployuje dowolną aplikację Node.js bez konfiguracji. Auto-detection runtime, pełna kompatybilność npm, WebSocket GA. Koszt: $5/mies. (Hobby z $5 credit). Docs z `llms-full.txt`. Główne braki: brak CLI rollback, bazy danych (Postgres/Redis/MongoDB) to unmanaged kontenery (brak automated backups, PITR). MCP status unverified. Dystans do Cloudflare: brak free tier i słabsza integracja agentowa.

#### 3. Vercel (Third)

Świetne CLI i docs agent-readable (`llms-full.txt`, MCP GA). Free tier pokrywa 1M invocations. Serverless Node.js z natywnym TypeScript. Główne braki: Vercel Postgres i KV wycofane (deprecated), Blob w beta — wymusza zewnętrzne providery (Neon, Upstash). 60s timeout na Hobby (ryzykowne dla AI proxy calls). Logi przechowywane 1h na free. Dystans do Cloudflare: brak własnych managed services, krótszy timeout.

## Anti-Bias Cross-Check: Cloudflare Workers + Pages

### Devil's Advocate — Weaknesses

1. **V8 isolates ≠ Node.js** — npm pakiety z natywnych modułów (bcrypt, sharp, better-sqlite3) nie działają. Wymaga alternatyw JS/Wasm (bcryptjs, Cloudflare Images, D1 binding). Solo dev traci czas na compatibility issues.
2. **CPU limit 10ms (free) / 30s (paid)** — fetch-and-forward do AI API jest OK, ale lokalny processing (parsowanie dużych JSON, audio transformacje) uderzy w ścianę. "Free" tier ma ukryty upgrade path do $5/mo.
3. **D1 = SQLite, nie Postgres** — brak JSONB, zaawansowanych indeksów. Migracja do Postgres później = przepisanie warstwy danych. Vendor lock-in na dialekcie SQL.
4. **Workers-specific DX** — brak Express/Fastify natywnie. Wymaga Hono/itty-router. Testy przez miniflare mogą nie odtwarzać edge-case'ów produkcyjnych.
5. **Secret rotation = redeploy** — `wrangler secret put` tworzy nową wersję deploymentu za każdym razem.

### Pre-Mortem — How This Could Fail

Sześć miesięcy po deployu na Cloudflare Workers, "My English Day" ugrzęzło. Solo developer spędził pierwszy tydzień walcząc z kompatybilnością npm — biblioteka do audio processing nie działała na V8 isolates, więc napisał workaround przez Wasm, który spowalniał cold starty. D1 na początku wystarczał, ale gdy baza fiszek przekroczyła 10k rekordów, brak JSONB i ograniczony SQL zaczął generować hacki w kodzie. Testy integracyjne z miniflare nie pokrywały zachowań produkcyjnych — bug z Durable Objects pojawił się dopiero na produkcji. Gdy przyszedł czas na background jobs (codzienne generowanie fiszek), Queues działały, ale debugowanie failed jobs wymagało ręcznego parsowania logów z `wrangler tail`. Największy cios: migracja do Postgres (wymagana przez nowego klienta) oznaczała przepisanie całej warstwy danych z D1/SQLite — 2 tygodnie pracy, których nikt nie zaplanował.

### Unknown Unknowns

- **Wrangler dev ≠ produkcja** — lokalne `wrangler dev` emuluje Workers, ale różnice w cache'u, limitach CPU i bindingach D1 mogą generować bugi widoczne tylko po deployu.
- **Brak connection pooling** — Workers nawiązują nowe połączenie do zewnętrznych baz przy każdym requescie. Użycie zewnętrznego Postgres zamiast D1 uderzy w limity połączeń.
- **Preview URL publiczne domyślnie** — ochrona wymaga Cloudflare Access (dodatkowa konfiguracja/koszt). Dla API z danymi użytkowników to ryzyko.
- **50 queries/invocation na free tier** — endpoint sprawdzający duplikaty fiszek + zapis + aktualizacja statystyk może przekroczyć limit w jednym requescie.
- **Cron Triggers: min 1 minuta, max 30s execution (free)** — dłuższy processing wymaga Queues + Durable Objects — komplikacja architekturalna.

## Operational Story

- **Preview deploys**: `wrangler deploy --env preview` tworzy osobny Worker. Dla Pages: każdy push na branch non-production generuje preview URL (`<branch>.<project>.pages.dev`). URL publiczny domyślnie — ochrona przez Cloudflare Access (dodatkowa konfiguracja).
- **Secrets**: `wrangler secret put SECRET_NAME` — przechowywane w Cloudflare's encrypted vault, dostępne jako env vars w runtime. `wrangler secret list` listuje (nie pokazuje wartości). Rotacja: `wrangler secret put` nadpisuje wartość i tworzy nowy deployment.
- **Rollback**: `wrangler rollback [VERSION_ID]` — natychmiastowe przywrócenie poprzedniej wersji. `wrangler versions list` pokazuje historię. Czas do reverta: sekundy. Caveat: rollback nie cofa zmian w D1/R2 — migracje bazy wymagają osobnego rollbacku.
- **Approval**: human-only: usunięcie projektu, rotacja API token, zmiana planu billingowego, bulk delete z R2. Agent: deploy, rollback, secret put, tail logs, D1 queries.
- **Logs**: `wrangler tail [WORKER_NAME]` — streaming live logs z filtrami (`--status error`, `--method POST`, `--search "keyword"`). JSON output. Brak persisted log storage na free — logi wyłącznie live stream. Dla persisted: Logpush do external (dodatkowa konfiguracja).

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| npm package incompatible z V8 isolates | Devil's advocate | M | H | Weryfikuj kompatybilność przed instalacją. Użyj `bcryptjs` zamiast `bcrypt`, Hono zamiast Express. Testuj z `wrangler dev` natychmiast. |
| CPU limit przekroczony przy local processing | Devil's advocate | L | M | Użyj AI API do heavy processing (transkrypcja, generowanie). Lokalny kod = lekkie transformacje. Upgrade do paid ($5/mo) jeśli trzeba. |
| D1/SQLite vendor lock-in | Devil's advocate | M | M | Użyj ORMa (Drizzle) z abstrakcją dialektu. Jeśli migracja do Postgres kiedyś nastąpi, Drizzle supportuje oba. |
| Miniflare ≠ produkcja (bugs w testach) | Unknown unknowns | M | M | Deploy preview environment na Cloudflare i testuj tam. Nie polegaj wyłącznie na `wrangler dev`. |
| Preview URL publiczne — data leak | Unknown unknowns | L | H | Skonfiguruj Cloudflare Access dla preview deployments lub używaj API keys na endpointach. |
| 50 queries/invocation limit (free) | Unknown unknowns | M | M | Batch queries w D1. Jeśli limit jest problemem, upgrade do paid (1000 queries/invocation). |
| Cron Trigger 30s execution limit (free) | Unknown unknowns | L | M | Użyj Queues do asynchronicznego processingu fiszek zamiast Cron Triggers. |
| Brak persisted logs | Research finding | M | L | Dla MVP: `wrangler tail` wystarczy do live debug. Dla produkcji: skonfiguruj Logpush. |

## Getting Started

1. **Zainstaluj Wrangler CLI**: `npm install -g wrangler`
2. **Zaloguj się do Cloudflare**: `wrangler login` (otwiera przeglądarkę, jednorazowo)
3. **Zainicjalizuj projekt Workers**: `wrangler init my-english-day-api` — wybierz "Hello World" template z TypeScript
4. **Utwórz bazę D1**: `wrangler d1 create my-english-day-db` — skopiuj `database_id` do `wrangler.toml`
5. **Deploy**: `wrangler deploy` — dostaniesz URL `<worker>.workers.dev`. Zweryfikuj: `curl https://<worker>.workers.dev`

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
