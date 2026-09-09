# Follow-up: wersja Node dla CI i dane konta w rekordzie deployu

- **Źródło**: impl-review `testing-quality-gates` F4 (💡 OBSERWACJA) i F6 (💡 OBSERWACJA), 2026-09-09.
- **F4 — wersja Node**: repo nie ma `engines` w `package.json` ani `.node-version`/`.nvmrc`; lokalnie Node 24.16, Expo SDK 56 wymaga ≥ 20.19. `npm run gate` w CI bez przypiętej wersji może dostać inny Node niż lokalnie. Zadanie (przy podłączaniu CI, lekcja CI): dodać `"engines": { "node": ">=20.19" }` w root i `api/` (albo `.node-version` = `24`) i użyć go w kroku `setup-node`. Poza zakresem Fazy 4 (plan: bez zmian w `package.json` poza skryptami).
- **F6 — dane konta w `context/deployment/deploy-plan.md:28`**: rekord z 2026-05-28 zawiera e-mail konta Cloudflare i account ID (jedyne takie miejsce w `context/`). Nie są sekretami, ale przy upublicznieniu repo warto je usunąć lub przenieść poza git. Zadanie: decyzja użytkownika; jeśli tak — zastąpić `<account>` i zanotować w `deploy-checklist.md`, że `wrangler whoami` pokazuje konto.
- **Kryterium zamknięcia**: F4 — `engines`/`.node-version` w repo i użyte w workflow; F6 — decyzja zapisana tutaj z datą.
- **Status**: otwarty (2026-09-09).
