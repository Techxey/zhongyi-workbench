import { KbSearchOverlay } from "@/components/kb-search-overlay";
import { getSession } from "@/lib/auth";
import { Rail } from "@/components/rail";

export default async function WorkbenchLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();
  return (
    <div className="min-h-screen bg-canvas max-lg:flex max-lg:flex-col">
      <Rail userName={user?.name ?? "医生"} />
      <div className="pl-[78px] min-h-screen max-lg:pl-0 max-lg:min-h-0">{children}</div>
      <KbSearchOverlay />
    </div>
  );
}
