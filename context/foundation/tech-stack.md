---
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
---

## Why this stack

Solo developer budujący mobilną aplikację do nauki angielskiego w 3 tygodnie po godzinach. Expo (React Native) to rekomendowany domyślny starter dla komórki (mobile, js) — cross-platform iOS + Android z managed workflow, TypeScript-first, z pełnym wsparciem w danych treningowych AI agentów. Przechodzi wszystkie cztery bramy jakości: typowany (TypeScript), oparty na konwencjach (file-based routing, Expo config), popularny w danych treningowych i dobrze udokumentowany. Pewność scaffoldingu: verified — bootstrapper został przetestowany end-to-end. Auth i AI/LLM (transkrypcja + generowanie fiszek) to feature flagi wykryte z PRD; backend do tych funkcji będzie wymagał osobnego serwisu (np. Supabase, Firebase lub własne API). Deployment przez TestFlight/EAS do dystrybucji testowej. CI na GitHub Actions z auto-deploy po merge do main.
