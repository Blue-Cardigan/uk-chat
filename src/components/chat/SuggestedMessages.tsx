import { Button } from "@/components/ui/primitives";
import type { SuggestedPrompt } from "@/lib/types";

const prompts: SuggestedPrompt[] = [
  { id: "crime", label: "How safe is my area? Show crime data for SE1 1AA" },
  { id: "energy", label: "Compare energy use across London boroughs" },
  { id: "mp", label: "What has Keir Starmer voted on recently?" },
  { id: "flood", label: "Show flood warnings near Manchester" },
  { id: "councillors", label: "Who are my local councillors?" },
  { id: "demographics", label: "What's the demographic makeup of Bristol West?" },
];

export function SuggestedMessages({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {prompts.map((prompt, index) => (
        <Button
          key={prompt.id}
          variant="secondary"
          className="h-auto animate-[fadeIn_200ms_ease-out_both] justify-start py-2 text-left"
          style={{ animationDelay: `${index * 50}ms` }}
          onClick={() => onPick(prompt.label)}
        >
          {prompt.label}
        </Button>
      ))}
    </div>
  );
}
