"use client";

import { useCallback, useEffect, useState } from "react";
import {
  paintTheme,
  persistTheme,
  resolveDark,
  type ThemeChoice,
} from "@/lib/theme";

function currentIsDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

/** 侧栏上的快捷开关：在日间 / 夜间之间直接切换（显式选择，不跟系统） */
export function ThemeToggle() {
  const toggle = useCallback(() => {
    const next = !currentIsDark();
    paintTheme(next);
    persistTheme(next ? "dark" : "light");
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      title="切换日间 / 夜间"
      aria-label="切换日间 / 夜间模式"
      className="w-[44px] h-[36px] rounded-[8px] grid place-items-center text-white/40 hover:text-white/85 hover:bg-white/8 transition-colors"
    >
      {/* 日间显示月亮（点它进夜间）；夜间显示太阳 */}
      <svg className="dark:hidden" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M20.4 14.6A8.4 8.4 0 0 1 9.4 3.6a8.6 8.6 0 1 0 11 11Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <svg
        className="hidden dark:block"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

/** 登录页用的浮动开关 */
export function ThemeFloatingToggle() {
  const toggle = useCallback(() => {
    const next = !currentIsDark();
    paintTheme(next);
    persistTheme(next ? "dark" : "light");
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      title="切换日间 / 夜间"
      aria-label="切换日间 / 夜间模式"
      className="fixed top-5 right-5 btn btn-ghost text-[12.5px]"
    >
      <svg className="dark:hidden" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M20.4 14.6A8.4 8.4 0 0 1 9.4 3.6a8.6 8.6 0 1 0 11 11Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <svg
        className="hidden dark:block"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
      <span className="dark:hidden">夜间模式</span>
      <span className="hidden dark:inline">日间模式</span>
    </button>
  );
}

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "日间" },
  { value: "dark", label: "夜间" },
  { value: "system", label: "跟随系统" },
];

/** 设置页里的三档外观选择 */
export function ThemeSegmented({ initial }: { initial: ThemeChoice }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);

  // 跟随系统时，系统主题变化要实时跟上
  useEffect(() => {
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => paintTheme(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  const select = (value: ThemeChoice) => {
    setChoice(value);
    paintTheme(resolveDark(value));
    persistTheme(value);
  };

  return (
    <div
      role="group"
      aria-label="界面外观"
      className="inline-flex items-center gap-1 p-[3px] rounded-[9px] bg-ghost border border-line-2"
    >
      {OPTIONS.map((opt) => {
        const active = choice === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => select(opt.value)}
            aria-pressed={active}
            className={
              active
                ? "h-[30px] px-3.5 rounded-[7px] text-[12.5px] bg-seg-active text-ink border border-line shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                : "h-[30px] px-3.5 rounded-[7px] text-[12.5px] text-ink-3 hover:text-ink transition-colors"
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
