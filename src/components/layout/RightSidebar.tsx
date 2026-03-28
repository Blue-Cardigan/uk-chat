import { X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { VizRouter } from "@/components/viz/VizRouter";
import { useAppStore } from "@/lib/store";

export function RightSidebar() {
  const payloads = useAppStore((state) => state.vizPayloads);
  const setRightSidebarOpen = useAppStore((state) => state.setRightSidebarOpen);

  return (
    <aside className="relative flex h-full min-h-0 w-full flex-col border-l border-(--color-border) bg-(--color-sidebar) p-3">
      <Button
        variant="ghost"
        aria-label="Close sidebar"
        className="absolute right-2 top-2 h-7 w-7 p-0 opacity-60 hover:opacity-100"
        onClick={() => setRightSidebarOpen(false)}
      >
        <X className="h-4 w-4" />
      </Button>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pt-6">
        {payloads.length > 0 && (
          payloads.map((payload) => <VizRouter key={payload.id} payload={payload} />)
        )}
      </div>
    </aside>
  );
}
