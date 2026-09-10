---
project: my-english-day
deployed_at: 2026-09-10
platform: Cloudflare Workers + Pages
status: deployed
---

## Deployment Record

### URLs

- **Frontend (Pages)**: https://my-english-day.pages.dev
- **Preview URL**: https://66215e1e.my-english-day.pages.dev (2026-09-10)
- **Backend (Workers)**: https://my-english-day-api.kali82marek.workers.dev
- **Health endpoint**: https://my-english-day-api.kali82marek.workers.dev/health

### Resources

| Resource | Name | ID |
|---|---|---|
| Workers | my-english-day-api | Version: 55099ca1-814e-4099-b501-370eeba11f46 (2026-09-10; stub z 2026-05-28: 70618744-13c1-406f-a83a-bf778fab6f8d) |
| Pages | my-english-day | — |
| D1 Database | my-english-day-db | 9bc5235d-6547-4b4d-8d6d-b62380e6f678 |

### Configuration

- **Wrangler version**: 4.95.0
- **Cloudflare Account**: kali82marek@gmail.com (c78145c95cc06c098957195cd395055f)
- **Workers subdomain**: kali82marek.workers.dev
- **D1 region**: EEUR
- **Backend framework**: Hono (health endpoint only)
- **Frontend**: Expo web static export (4 routes: /, /explore, /_sitemap, /+not-found)

### What was deployed

**2026-09-10 — pierwszy pełny deploy produktu (F-01…S-05 + poprawka web z `ba23c2d`)**

- D1: migracje 0001–0005 zaaplikowane `--remote` (baza była pusta — deploy z maja nigdy nie dostał schematu).
- Sekrety Workera: `JWT_SECRET` (nowa losowa wartość, inna niż w `.dev.vars`) i `OPENAI_API_KEY` ustawione przez `wrangler secret put` — `secret list` przed deployem był pusty mimo zapisu poniżej.
- Worker 55099ca1: auth, situations (upload R2 + Whisper + generowanie fiszek w tle), flashcards (proposals / accept / delete / review / grade).
- Smoke na produkcji (użytkownik testowy `smoke-*@example.com`, 2 sytuacje z `api/scripts/sample.wav`): 201 w ~1,1 s, transkrypcja PL i 8 propozycji; accept ×3 → review `dueCount 3`; `good` zdejmuje, `again` zostawia, `easy` → 400; druga identyczna sytuacja bez dubli zaakceptowanych frontów (S-04 2.3, S-05 2.3).
- Pages: eksport z `EXPO_PUBLIC_API_BASE_URL` (patrz `app.config.js`), bundle celuje w Worker, brak `localhost:3030`.
- Nie zweryfikowano w przeglądarce na Pages: wiersze Manual UI S-04 2.4, S-05 3.3–3.6 (do przeklikania przez użytkownika).

**2026-05-28 — stub**

**Backend stub** (`api/`):
- Hono app z jednym endpointem `GET /health`
- CORS skonfigurowany dla `my-english-day.pages.dev` + localhost (8081, 19006)
- D1 binding `DB` (baza pusta, 0 tabel)
- Environment variable `ENVIRONMENT = "production"`

**Frontend** (Expo web export):
- 17 plików statycznych (HTML, CSS, JS)
- 4 statyczne routes
- React Compiler enabled

### Deploy commands

Pełna kolejność (migracja D1 PRZED `wrangler deploy`, smoke, rollback): `deploy-checklist.md`.

```bash
# Backend
cd api && npx wrangler d1 migrations apply my-english-day-db --remote
npx wrangler deploy

# Frontend
npx expo export --platform web
npx wrangler pages deploy dist --project-name my-english-day
```

### Następne kroki

1. ~~Dodać schemat D1 (users, situations, flashcards) z migracjami~~ (done)
2. ~~Dodać auth endpointy (register, login)~~ (done)
3. ~~Dodać AI integration (transkrypcja, generowanie fiszek)~~ (done)
4. Skonfigurować GitHub Actions CI/CD (auto-deploy on merge)
5. ~~Zaktualizować CORS origin po potwierdzeniu finalnego URL Pages~~ (`my-english-day.pages.dev` jest w CORS; preview URL-e `*.my-english-day.pages.dev` NIE są — testuj na domenie głównej)
6. Checklista deployu: `deploy-checklist.md` (2026-09-09)
