import AppTabs from '@/components/app-tabs';

/**
 * Layout chronionej grupy `(app)` — osadza tab-navigator pod bramką auth.
 * Root layout renderuje tę grupę tylko dla zalogowanego użytkownika; tu żyją
 * taby (`index`/`explore`). Grupa w nawiasach NIE zmienia URL (`/`, `/explore`).
 */
export default function AppGroupLayout() {
  return <AppTabs />;
}
