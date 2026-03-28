import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants: Record<"default" | "ghost" | "secondary" | "accent", string> = {
  default: "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:opacity-90",
  accent: "bg-[var(--color-accent)] text-[var(--color-accent-foreground)] hover:opacity-90",
  secondary: "bg-[var(--color-card)] text-[var(--color-foreground)] border border-(--color-border) hover:bg-[var(--color-card)]/80",
  ghost: "text-[var(--color-foreground)] hover:bg-[var(--color-card)]",
};

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "ghost" | "secondary" | "accent" }
>(function Button({ className, variant = "default", ...props }, ref) {
  const variants = {
    default: buttonVariants.default,
    accent: buttonVariants.accent,
    secondary: buttonVariants.secondary,
    ghost: buttonVariants.ghost,
  } as const;

  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});
Button.displayName = "Button";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function Card({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn("rounded-xl border border-(--color-border) bg-(--color-card) p-4 shadow-sm", className)}
      {...props}
    />
  );
});
Card.displayName = "Card";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) {
  return (
    <input
      ref={ref}
      {...props}
      className={cn(
        "h-10 w-full rounded-md border border-(--color-border) bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-(--color-ring)",
        props.className,
      )}
    />
  );
});
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  props,
  ref,
) {
  return (
    <textarea
      ref={ref}
      {...props}
      className={cn(
        "min-h-24 w-full rounded-md border border-(--color-border) bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-(--color-ring)",
        props.className,
      )}
    />
  );
});
Textarea.displayName = "Textarea";
