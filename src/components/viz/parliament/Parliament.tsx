import { VisualizationCard } from "@/components/viz/VisualizationCard";

export function HansardReader() {
  return (
    <VisualizationCard title="HansardReader">
      <p className="text-xs leading-relaxed">
        “We need stronger regional investment strategies...”<br />
        <span className="text-[var(--color-muted-foreground)]">House of Commons, sample excerpt</span>
      </p>
    </VisualizationCard>
  );
}

export function VotingMatrix() {
  return (
    <VisualizationCard title="VotingMatrix">
      <div className="grid grid-cols-6 gap-1">
        {Array.from({ length: 24 }).map((_, index) => (
          <span key={index} className={`h-4 rounded ${index % 3 === 0 ? "bg-emerald-500/70" : index % 3 === 1 ? "bg-rose-500/70" : "bg-slate-400/70"}`} />
        ))}
      </div>
    </VisualizationCard>
  );
}

export function CommitteeMemberList() {
  return (
    <VisualizationCard title="CommitteeMemberList">
      <ul className="space-y-1 text-xs">
        <li>Chair: Member A</li>
        <li>Member B</li>
        <li>Member C</li>
      </ul>
    </VisualizationCard>
  );
}

export function InterestsPanel() {
  return (
    <VisualizationCard title="InterestsPanel">
      <ul className="space-y-1 text-xs">
        <li>Consultancy: £15k</li>
        <li>Property: Declared</li>
      </ul>
    </VisualizationCard>
  );
}

export function QAPanel() {
  return (
    <VisualizationCard title="QAPanel">
      <p className="text-xs">
        <strong>Question:</strong> What funding is allocated to local flood defenses?<br />
        <strong>Status:</strong> Answered
      </p>
    </VisualizationCard>
  );
}
