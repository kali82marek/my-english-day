/**
 * Dynamiczna nakładka na `app.json` (Expo scala oba pliki; ten ma pierwszeństwo).
 *
 * Jedyne, co nadpisujemy, to `extra.apiBaseUrl`: eksport produkcyjny na Pages musi
 * celować w Worker, a nie w `localhost:3030` z `app.json`. Ustaw
 * `EXPO_PUBLIC_API_BASE_URL` przed `npm run web:export` (patrz
 * `context/deployment/deploy-checklist.md`, krok 8). Bez zmiennej — wartość z `app.json`.
 */
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || config.extra?.apiBaseUrl,
  },
});
