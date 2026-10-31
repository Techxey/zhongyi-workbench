import type { Metadata } from "next";
import "./globals.css";
import { themeClass } from "@/lib/theme";
import { getThemeChoice } from "@/lib/theme-server";

export const metadata: Metadata = {
  title: "中医诊疗工作台",
  description: "单人中医诊所的接诊工作台：问诊、辨证、处方、病历留痕。",
};

/**
 * 首屏防闪：在样式生效前按 Cookie 决定 .dark。
 * 选择“跟随系统”时，服务端无法预知，由这段脚本按 prefers-color-scheme 解析。
 */
const THEME_BOOT = `(function(){try{var m=document.cookie.match(/(?:^|; )zyb_theme=([^;]*)/);var v=m?decodeURIComponent(m[1]):"light";var d=v==="dark"||(v==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await getThemeChoice();

  return (
    <html lang="zh-CN" className={themeClass(theme)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
