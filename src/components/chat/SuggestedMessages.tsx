import { Button } from "@/components/ui/primitives";
import { Landmark } from "lucide-react";
import type { SuggestedPrompt } from "@/lib/types";

type PromptMode = "chat" | "council";
type PromptAction = "prompt" | "switch-to-council";
type ModeSuggestedPrompt = SuggestedPrompt & { mode: PromptMode; action?: PromptAction };

const chatPrompts: ModeSuggestedPrompt[] = [
  { id: "crime", label: "How safe is my area? Show crime data for SE1 1AA", mode: "chat" },
  { id: "energy", label: "Compare energy use across London boroughs", mode: "chat" },
  { id: "mp", label: "What has Keir Starmer voted on recently?", mode: "chat" },
  { id: "flood", label: "Show flood warnings near Manchester", mode: "chat" },
  { id: "demographics", label: "What's the demographic makeup of Bristol West?", mode: "chat" },
  { id: "switch-to-council", label: "Ask a group of MPs and Councillors", mode: "chat", action: "switch-to-council" },
];

const councilPrompts: ModeSuggestedPrompt[] = [
  { id: "councillors", label: "Build a local council for SE1 1AA focused on housing and transport.", mode: "council" },
  { id: "national-council", label: "Build a national representative council of MPs to debate NHS waiting lists.", mode: "council" },
  { id: "southwark-council", label: "Create a local council for SE15 5PU to prioritise housing safety, schools, and policing.", mode: "council" },
  { id: "climate-council", label: "Assemble a national MPs council to debate net zero delivery and household energy costs.", mode: "council" },
  { id: "transport-council", label: "Build a local council for M14 6EZ focused on buses, active travel, and road safety.", mode: "council" },
];

export function SuggestedMessages({
  councilModeEnabled,
  onPick,
  onSwitchToCouncilMode,
}: {
  councilModeEnabled: boolean;
  onPick: (payload: { text: string; mode: PromptMode }) => void;
  onSwitchToCouncilMode?: () => void;
}) {
  const prompts = councilModeEnabled ? councilPrompts : chatPrompts;

  return (
    <div className="grid gap-2 md:grid-cols-2">
      {prompts.map((prompt, index) => (
        <Button
          key={prompt.id}
          variant="secondary"
          className="h-auto animate-[fadeIn_200ms_ease-out_both] justify-start py-2 text-left"
          style={{ animationDelay: `${index * 50}ms` }}
          onClick={() => {
            if (prompt.action === "switch-to-council") {
              onSwitchToCouncilMode?.();
              return;
            }
            onPick({ text: prompt.label, mode: prompt.mode });
          }}
        >
          {prompt.action === "switch-to-council" ? (
            <span className="inline-flex items-center gap-2">
              <Landmark className="size-4" aria-hidden="true" />
              {prompt.label}
            </span>
          ) : (
            prompt.label
          )}
        </Button>
      ))}
    </div>
  );
}
