"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/login/actions";
import { ThemeToggle } from "@/components/theme-toggle";

type NavItem = {
  key: string;
  label: string;
  href: string | null;
  hint?: string;
  icon: React.ReactNode;
};

const IconClinic = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="4.6" y="3.6" width="14.8" height="16.8" rx="2.4" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8.4 3.6v2.2M15.6 3.6v2.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path
      d="M8.2 12.4h1.9l1.1-2.2 1.7 4.4 1.1-2.2h1.9"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M9 17.2h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const IconPatients = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.6" />
    <path
      d="M3.2 19.2c0-3.2 2.6-5.4 5.8-5.4s5.8 2.2 5.8 5.4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path
      d="M16.2 5.4a3 3 0 0 1 0 5.6M17.6 13.9c2.2.5 3.6 2.2 3.6 4.6"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

const IconKb = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M4 5.2C4 4 5 3 6.2 3H10c1.1 0 2 .9 2 2v15c0-.8-.7-1.4-1.5-1.4H6.2C5 18.6 4 17.6 4 16.4V5.2Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="M20 5.2C20 4 19 3 17.8 3H14c-1.1 0-2 .9-2 2v15c0-.8.7-1.4 1.5-1.4h6.3c1.2 0 2.2-1 2.2-2.2V5.2Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
);

const IconSettings = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    <path
      d="M12 3.2v2.1M12 18.7v2.1M4.8 12H2.7M21.3 12h-2.1M6.9 6.9 5.4 5.4M18.6 18.6l-1.5-1.5M17.1 6.9l1.5-1.5M5.4 18.6l1.5-1.5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

const NAV: NavItem[] = [
  { key: "clinic", label: "接诊", href: null, hint: "接诊台将在下一轮上线", icon: IconClinic },
  { key: "patients", label: "患者", href: "/patients", icon: IconPatients },
  { key: "kb", label: "知识库", href: null, hint: "知识库将在第三轮上线", icon: IconKb },
  { key: "settings", label: "设置", href: "/settings", icon: IconSettings },
];

export function Rail({ userName }: { userName: string }) {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 w-[78px] bg-rail text-white/60 flex flex-col items-center z-30">
      <Link
        href="/patients"
        className="mt-4 mb-6 w-9 h-9 rounded-[9px] bg-white/10 grid place-items-center font-serif text-[17px] text-rail-brand hover:bg-white/15 transition-colors"
        title="中医诊疗工作台"
      >
        医
      </Link>

      <nav className="flex flex-col items-center gap-1.5 w-full px-2">
        {NAV.map((item) => {
          const active = item.href ? pathname.startsWith(item.href) : false;
          const base =
            "relative w-full h-[52px] rounded-[9px] flex flex-col items-center justify-center gap-1 text-[10.5px] tracking-wide transition-colors";
          const classes = active
            ? `${base} bg-white/12 text-white`
            : item.href
              ? `${base} hover:bg-white/8 hover:text-white/90`
              : `${base} text-white/38 cursor-not-allowed`;

          const inner = (
            <>
              {active ? (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 rounded-full bg-brand-soft" />
              ) : null}
              {item.icon}
              <span>{item.label}</span>
            </>
          );

          if (!item.href) {
            return (
              <div key={item.key} className={classes} title={item.hint} aria-disabled>
                {inner}
              </div>
            );
          }

          return (
            <Link key={item.key} href={item.href} className={classes} title={item.label}>
              {inner}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto mb-4 flex flex-col items-center gap-3">
        <ThemeToggle />
        <form action={logout}>
          <button
            type="submit"
            className="w-[44px] h-[36px] rounded-[8px] grid place-items-center text-white/40 hover:text-white/80 hover:bg-white/8 transition-colors"
            title="退出登录"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M14.5 8V5.5A1.5 1.5 0 0 0 13 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H13a1.5 1.5 0 0 0 1.5-1.5V16"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M10 12h10m0 0-3-3m3 3-3 3"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>
        <div
          className="w-7 h-7 rounded-full bg-white/10 grid place-items-center text-[11px] text-white/70"
          title={userName}
        >
          {userName.slice(0, 1)}
        </div>
      </div>
    </aside>
  );
}
