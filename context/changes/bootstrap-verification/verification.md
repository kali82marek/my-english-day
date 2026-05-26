---
bootstrapped_at: 2026-05-26T22:30:00Z
starter_id: expo
starter_name: "Expo (React Native)"
project_name: my-english-day
language_family: js
package_manager: npm
cwd_strategy: subdir-then-move
bootstrapper_confidence: verified
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: expo
package_manager: npm
project_name: my-english-day
hints:
  language_family: js
  team_size: solo
  deployment_target: testflight
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

Solo developer budujący mobilną aplikację do nauki angielskiego w 3 tygodnie po godzinach. Expo (React Native) to rekomendowany domyślny starter dla komórki (mobile, js) — cross-platform iOS + Android z managed workflow, TypeScript-first, z pełnym wsparciem w danych treningowych AI agentów. Przechodzi wszystkie cztery bramy jakości: typowany (TypeScript), oparty na konwencjach (file-based routing, Expo config), popularny w danych treningowych i dobrze udokumentowany. Pewność scaffoldingu: verified — bootstrapper został przetestowany end-to-end. Auth i AI/LLM (transkrypcja + generowanie fiszek) to feature flagi wykryte z PRD; backend do tych funkcji będzie wymagał osobnego serwisu (np. Supabase, Firebase lub własne API). Deployment przez TestFlight/EAS do dystrybucji testowej. CI na GitHub Actions z auto-deploy po merge do main.

## Pre-scaffold verification

| Signal             | Value                                          | Severity | Notes                              |
| ------------------ | ---------------------------------------------- | -------- | ---------------------------------- |
| npm package        | create-expo-app v4.0.0 published 2026-05-15    | fresh    | resolved from cmd_template         |
| GitHub repo        | not run                                        | —        | gh CLI not installed               |

## Scaffold log

**Resolved invocation**: `npx create-expo-app .bootstrap-scaffold --yes --template default`
**Strategy**: subdir-then-move
**Exit code**: 0
**Files moved**: ~600+ (including node_modules)
**Conflicts (.scaffold siblings)**: CLAUDE.md.scaffold, .claude/settings.json.scaffold
**.gitignore handling**: moved silently (absent in cwd)
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 0 HIGH, 11 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/2/0 direct of total 0/0/11/0

#### CRITICAL findings

None.

#### HIGH findings

None.

#### MODERATE findings

1. **uuid** v7.0.3 — GHSA-w5hq-g745-h8pq: Missing buffer bounds check in v3/v5/v6 when buf is provided. CVSS 7.5. Fix: uuid >= 11.1.1. Transitive (via xcode → @expo/config-plugins).
2. **xcode** — moderate via uuid. Transitive.
3. **@expo/config-plugins** — moderate via xcode. Transitive.
4. **@expo/config** — moderate via @expo/config-plugins. Transitive.
5. **@expo/cli** — moderate via @expo/config, @expo/config-plugins, @expo/inline-modules, @expo/metro-config, @expo/prebuild-config. Transitive.
6. **@expo/inline-modules** — moderate via @expo/config-plugins. Transitive.
7. **@expo/local-build-cache-provider** — moderate via @expo/config. Transitive.
8. **@expo/metro-config** — moderate via @expo/config. Transitive.
9. **@expo/prebuild-config** — moderate via @expo/config, @expo/config-plugins. Transitive.
10. **expo** — moderate via @expo/cli, @expo/config, @expo/config-plugins, @expo/local-build-cache-provider, @expo/metro-config. Direct.
11. **expo-splash-screen** — moderate via @expo/config-plugins. Direct.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                       | Value                              |
| -------------------------- | ---------------------------------- |
| bootstrapper_confidence    | verified                           |
| quality_override           | false                              |
| path_taken                 | standard                           |
| self_check_answers         | null                               |
| team_size                  | solo                               |
| deployment_target          | testflight                         |
| ci_provider                | github-actions                     |
| ci_default_flow            | auto-deploy-on-merge               |
| has_auth                   | true                               |
| has_payments               | false                              |
| has_realtime               | false                              |
| has_ai                     | true                               |
| has_background_jobs        | false                              |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
