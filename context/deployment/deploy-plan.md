---
project: my-english-day
deployed_at: 2026-05-28
platform: Cloudflare Workers + Pages
status: deployed
---

## Deployment Record

### URLs

- **Frontend (Pages)**: https://my-english-day.pages.dev
- **Preview URL**: https://8a9c8421.my-english-day.pages.dev
- **Backend (Workers)**: https://my-english-day-api.kali82marek.workers.dev
- **Health endpoint**: https://my-english-day-api.kali82marek.workers.dev/health

### Resources

| Resource | Name | ID |
|---|---|---|
| Workers | my-english-day-api | Version: 70618744-13c1-406f-a83a-bf778fab6f8d |
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

```bash
# Backend
cd api && npx wrangler deploy

# Frontend
npx expo export --platform web
npx wrangler pages deploy dist --project-name my-english-day
```

### Następne kroki

1. Dodać schemat D1 (users, situations, flashcards) z migracjami
2. Dodać auth endpointy (register, login)
3. Dodać AI integration (transkrypcja, generowanie fiszek)
4. Skonfigurować GitHub Actions CI/CD (auto-deploy on merge)
5. Zaktualizować CORS origin po potwierdzeniu finalnego URL Pages
