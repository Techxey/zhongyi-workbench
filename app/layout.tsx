import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "中医诊疗工作台",
  description: "单人中医诊所的接诊工作台：问诊、辨证、处方、病历留痕。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
