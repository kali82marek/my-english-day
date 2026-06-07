import AppTabs from '@/components/app-tabs';

/**
 * Layout chronionej grupy `(app)` — osadza tab-navigator pod bramką auth.
 * Root layout renderuje tę grupę tylko dla zalogowanego użytkownika; tu żyje
 * ekran główny (`index`). Grupa w nawiasach NIE zmienia URL (ekran pod `/`).
 */
export default function AppGroupLayout() {
  return <AppTabs />;
}
