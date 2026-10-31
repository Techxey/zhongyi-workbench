/** 主题相关的最小共享定义：服务端与客户端都能 import（不含 next/headers）。 */

export const THEME_COOKIE = "zyb_theme";

export type ThemeChoice = "light" | "dark" | "system";

export const DEFAULT_THEME: ThemeChoice = "light";

export function normalizeTheme(value: string | undefined): ThemeChoice {
  return value === "dark" || value === "light" || value === "system" ? value : DEFAULT_THEME;
}

/** 服务端渲染时只能确定 light / dark；system 交给浏览器里的内联脚本解析 */
export function themeClass(choice: ThemeChoice): string {
  return choice === "dark" ? "dark" : "";
}

export function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveDark(choice: ThemeChoice): boolean {
  if (choice === "dark") return true;
  if (choice === "light") return false;
  return prefersDark();
}

export function persistTheme(choice: ThemeChoice): void {
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${THEME_COOKIE}=${choice}; path=/; max-age=${oneYear}; samesite=lax`;
}

/** 切换 .dark 类，带一个短过渡避免整屏闪 */
export function paintTheme(dark: boolean): void {
  const root = document.documentElement;
  root.classList.add("theme-anim");
  root.classList.toggle("dark", dark);
  root.dataset.theme = dark ? "dark" : "light";
  window.setTimeout(() => root.classList.remove("theme-anim"), 280);
}
