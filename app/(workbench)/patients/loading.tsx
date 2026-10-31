export default function PatientsLoading() {
  return (
    <>
      <div className="sticky top-0 z-20 h-[74px] bg-surface border-b border-line flex items-center px-[26px]">
        <div className="h-4 w-16 rounded bg-ghost" />
      </div>
      <div className="px-[26px] py-6 space-y-4">
        <div className="h-9 w-[320px] rounded-[8px] bg-ghost" />
        <div className="card overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-6 px-4 h-[58px] border-b border-line-2 last:border-b-0">
              <div className="w-[22%] space-y-1.5">
                <div className="h-3.5 w-16 rounded bg-ghost" />
                <div className="h-2.5 w-20 rounded bg-ghost" />
              </div>
              <div className="h-3 w-16 rounded bg-ghost" />
              <div className="h-3 w-14 rounded bg-ghost" />
              <div className="h-3 w-20 rounded bg-ghost" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
