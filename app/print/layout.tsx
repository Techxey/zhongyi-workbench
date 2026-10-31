import type { ReactNode } from "react";
import "./print.css";

export const metadata = {
  title: "处方打印",
};

export default function PrintLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
