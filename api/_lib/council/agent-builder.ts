// Copied from explore-the-kingdom worktree and adapted on 2026-03-30.
import { COUNCIL_INSTITUTION_PROFILES } from "./institutional-knowledge.js";
import type { CouncilAgent, CouncilInstitution, CouncillorsBundleLike, LocalMpApiResponse } from "./types.js";

function summarizeRoleBoundaries(institutions: CouncilInstitution[]): string[] {
  const limits = institutions.flatMap((institution) => COUNCIL_INSTITUTION_PROFILES[institution].limits);
  return [...new Set(limits)];
}

function mkId(prefix: string, raw: string): string {
  return `${prefix}:${raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown"}`;
}

export function buildCouncilAgents(input: {
  institutions: CouncilInstitution[];
  mpData: LocalMpApiResponse | null;
  councillorsData: CouncillorsBundleLike | null;
}): CouncilAgent[] {
  const roleBoundaries = summarizeRoleBoundaries(input.institutions);
  const agents: CouncilAgent[] = [];

  const mp = input.mpData?.member;
  if (mp) {
    const committeeRoles = (input.mpData?.committee_memberships ?? [])
      .map((membership) => membership.name)
      .filter((name) => typeof name === "string" && name.length > 0)
      .slice(0, 5);
    const contact = mp.contact?.[0] ?? null;
    agents.push({
      id: mkId("mp", mp.name_display_as),
      kind: "mp",
      name: mp.name_display_as,
      party: mp.party ?? null,
      title: `MP for ${mp.constituency ?? "this constituency"}`,
      wardOrConstituency: mp.constituency ?? null,
      committeeRoles,
      contact: {
        email: contact?.email ?? null,
        phone: contact?.phone ?? null,
        website: contact?.website ?? null,
      },
      focusAreas: input.mpData?.extras?.focus_areas ?? [],
      roleBoundaries,
      imageUrl: mp.portrait_url ?? mp.thumbnail_url ?? null,
      profileContext: [
        `Role: MP (${mp.party ?? "party unknown"})`,
        committeeRoles.length > 0 ? `Committee context: ${committeeRoles.join(", ")}` : null,
        input.mpData?.extras?.focus_areas?.length ? `Focus: ${input.mpData.extras.focus_areas.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(". "),
    });
  }

  const councillors = (input.councillorsData?.matched_councils ?? [])
    .flatMap((council) => (Array.isArray(council.councillors) ? council.councillors : []))
    .slice(0, 4);

  for (const councillor of councillors) {
    const committeeRoles = [...(councillor.roles ?? []), ...((councillor.role_links ?? []).map((item) => item.name))].filter(
      (item, idx, arr) => typeof item === "string" && item.length > 0 && arr.indexOf(item) === idx,
    );
    agents.push({
      id: mkId("cllr", councillor.councillor_name),
      kind: "councillor",
      name: councillor.councillor_name,
      party: councillor.party_name ?? null,
      title: "Councillor",
      wardOrConstituency: councillor.ward_name ?? null,
      committeeRoles: committeeRoles.slice(0, 5),
      contact: {
        email: councillor.emails?.[0] ?? null,
        phone: councillor.phones?.[0] ?? null,
        website: null,
      },
      focusAreas: committeeRoles.slice(0, 3),
      roleBoundaries,
      imageUrl: councillor.profile_image_url ?? null,
      profileContext: [
        `Role: Councillor (${councillor.party_name || "party unknown"})`,
        councillor.ward_name ? `Ward: ${councillor.ward_name}` : null,
        committeeRoles.length > 0 ? `Committees/roles: ${committeeRoles.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(". "),
    });
  }

  agents.push({
    id: "chair:system",
    kind: "chair",
    name: "Council Chair",
    party: null,
    title: "Deliberation Chair",
    wardOrConstituency: null,
    committeeRoles: [],
    contact: { email: null, phone: null, website: null },
    focusAreas: ["procedural fairness", "clarity", "actionable outcomes"],
    roleBoundaries,
    imageUrl: null,
    profileContext: "Neutral chair who keeps discussion grounded in legal powers, fiscal realities, and practical delivery steps.",
  });

  return agents;
}

