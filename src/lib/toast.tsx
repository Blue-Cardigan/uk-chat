import { useEffect } from "react";
import { create } from "zustand";
import { cn } from "@/lib/utils";

export type ToastKind = "info" | "success" | "warning" | "error";

export type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
  ttlMs: number;
};

type ToastInput = {
  kind?: ToastKind;
  message: string;
  ttlMs?: number;
};

type ToastStore = {
  toasts: Toast[];
  push: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
};

const DEFAULT_TTL_MS = 5000;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: ({ kind = "info", message, ttlMs = DEFAULT_TTL_MS }) => {
    const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    set((state) => ({ toasts: [...state.toasts, { id, kind, message, ttlMs }] }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export function pushToast(toast: ToastInput): string {
  return useToastStore.getState().push(toast);
}

const kindStyles: Record<ToastKind, string> = {
  info: "border-(--color-border) bg-(--color-card) text-(--color-foreground)",
  success: "border-(--color-primary) bg-(--color-card) text-(--color-foreground)",
  warning: "border-(--color-warning) bg-(--color-card) text-(--color-foreground)",
  error: "border-(--color-accent) bg-(--color-card) text-(--color-foreground)",
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    if (toast.ttlMs <= 0) return;
    const timer = window.setTimeout(() => dismiss(toast.id), toast.ttlMs);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.ttlMs, dismiss]);
  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex max-w-sm items-start gap-3 rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur",
        kindStyles[toast.kind],
      )}
    >
      <span className="flex-1 leading-snug">{toast.message}</span>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        className="-mr-1 rounded px-1 text-xs opacity-70 hover:opacity-100"
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
