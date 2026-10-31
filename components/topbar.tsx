export function TopBar({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 h-[74px] bg-surface border-b border-line flex items-center justify-between gap-6 px-[26px]">
      <div className="min-w-0 flex items-baseline gap-3">
        <h1 className="text-[17px] font-medium text-ink tracking-wide truncate">{title}</h1>
        {subtitle ? <p className="text-[12.5px] text-ink-3 truncate">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2.5 shrink-0">{actions}</div> : null}
    </header>
  );
}
