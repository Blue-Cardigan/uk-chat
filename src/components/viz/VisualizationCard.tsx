import { Card } from "@/components/ui/primitives";

export function VisualizationCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="animate-[slideUp_250ms_ease-out_both] space-y-3">
      <header>
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle ? <p className="text-xs text-(--color-muted-foreground)">{subtitle}</p> : null}
      </header>
      {children}
    </Card>
  );
}
