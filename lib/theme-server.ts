import { cookies } from "next/headers";
import { normalizeTheme, THEME_COOKIE, type ThemeChoice } from "@/lib/theme";

export async function getThemeChoice(): Promise<ThemeChoice> {
  const store = await cookies();
  return normalizeTheme(store.get(THEME_COOKIE)?.value);
}
