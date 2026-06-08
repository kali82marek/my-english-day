# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Język

Odpowiadaj użytkownikowi po polsku.

## Build & Development Commands

- `npm start` — uruchamia Expo dev server (alias: `npx expo start`)
- `npm run android` / `npm run ios` / `npm run web` — uruchamia na konkretnej platformie
- `npm run lint` — ESLint via `expo lint`
- Brak skonfigurowanych testów (brak Jest/Vitest w projekcie). Przed dodaniem testów: `npx expo install jest-expo jest @types/jest` + konfiguracja w package.json.

## Architecture

Stack i wersje: patrz `@package.json`. Konfiguracja Expo (React Compiler, typed routes): patrz `@app.json` → `experiments`.

### Struktura źródeł (`src/`)

- `src/app/` — ekrany (file-based routing). `_layout.tsx` to root layout z ThemeProvider i tab navigation.
- `src/components/` — komponenty UI. Pliki `.web.tsx` to warianty platform-specific (web).
- `src/constants/theme.ts` — kolory (light/dark), fonty, spacing, stałe layoutu.
- `src/hooks/` — custom hooks (`use-theme`, `use-color-scheme` z wariantem `.web.ts`).

### Path aliases

Patrz `@tsconfig.json` → `compilerOptions.paths`.

### Konwencje komponentów

- Pliki `.web.tsx` obok bazowych `.tsx` dla wariantów platformowych.
- Theming: kolory z `Colors.light` / `Colors.dark`, spacing z `Spacing.*` (nie magic numbers).
- Eksport domyślny (`export default`) dla ekranów, named export dla komponentów.

## Kontekst produktowy

Aplikacja "My English Day" — nauka angielskiego z codziennych sytuacji. Użytkownik nagrywa sytuację głosowo po polsku → AI transkrybuje i generuje fiszki angielskie → użytkownik akceptuje/odrzuca → nauka spaced repetition. Szczegóły w `@context/foundation/prd.md`, decyzje stackowe w `@context/foundation/tech-stack.md`.

Backend (auth, AI/transkrypcja, baza fiszek) jeszcze nie wybrany — planowany jako osobny serwis.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 3

Review AI-generated code before merge with the **implementation review chain**:

```
/10x-implement -> /10x-impl-review -> triage -> (/10x-lesson | fix | skip | disagree)
```

`/10x-impl-review` is the lesson focus. Review is a quality gate, not an instruction to fix every finding.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Code review (lesson focus)** | |
| `/10x-impl-review <change-id>` | You have implemented code and want a structured review before merge. The skill checks plan adherence, scope discipline, safety and quality, architecture, pattern consistency, and success criteria, then presents findings for triage. |
| **Recurring lesson outcome** | |
| `/10x-lesson` | A finding reveals a recurring project rule or agent failure pattern. Record it in `context/foundation/lessons.md` instead of treating it as a one-off note. |

### Triage discipline

- Severity says how bad the finding is. Impact says how much the decision matters now.
- Valid outcomes: fix now, fix differently, skip, accept as risk, record as recurring rule (`/10x-lesson`), disagree.
- Fix critical findings. Do not burn hours on low-impact observations just because the agent found them.
- Conscious skipping of low-impact findings is a valid review outcome, not negligence.
- If you disagree with a finding, record why. Wrong agent reasoning is also signal.

### Review boundaries

- This lesson reviews implemented code. It does not create the plan, execute new phases, or teach CI review.
- Testing strategy and quality gates are introduced in Module 3.
- Do not use `/10x-contract` as a triage outcome in this lesson.

### Paths used by this lesson

- `context/changes/<change-id>/plan.md` - expected implementation contract
- `context/changes/<change-id>/reviews/` - review output
- `context/foundation/lessons.md` - recurring lessons

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
