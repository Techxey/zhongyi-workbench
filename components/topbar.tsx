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
    <header className="sticky top-0 max-lg:top-[60px] z-20 h-[74px] max-lg:h-auto bg-surface border-b border-line flex items-center justify-between gap-6 px-[26px] max-lg:flex-col max-lg:items-stretch max-lg:gap-1.5 max-lg:py-2.5 max-lg:px-4">
      <div className="min-w-0 flex items-baseline gap-3">
        <h1 className="text-[17px] font-medium text-ink tracking-wide truncate">{title}</h1>
        {subtitle ? <p className="text-[12.5px] text-ink-3 truncate">{subtitle}</p> : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2.5 shrink-0 max-lg:overflow-x-auto max-lg:pb-0.5">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
