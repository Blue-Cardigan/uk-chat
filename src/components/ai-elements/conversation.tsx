import { cn } from "@/lib/utils";

export function Conversation({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto", className)}>{children}</div>;
}
