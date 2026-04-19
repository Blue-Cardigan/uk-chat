import { createContext, useContext } from "react";
import { Card } from "@/components/ui/primitives";

export const VizCompactContext = createContext(false);

export function VisualizationCard({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const compact = useContext(VizCompactContext);

  if (compact) {
    return (
      <Card className="animate-[slideUp_250ms_ease-out_both] space-y-2">
        {title ? (
          <header className="space-y-0.5">
            <h3 className="text-sm font-semibold">{title}</h3>
            {subtitle ? <p className="text-xs text-(--color-muted-foreground)">{subtitle}</p> : null}
          </header>
        ) : null}
        {children}
      </Card>
    );
  }

  return (
    <Card className="animate-[slideUp_250ms_ease-out_both] space-y-3">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle ? <p className="text-xs text-(--color-muted-foreground)">{subtitle}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
      {children}
    </Card>
  );
}
