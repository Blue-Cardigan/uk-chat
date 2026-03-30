// Copied from explore-the-kingdom worktree and adapted on 2026-03-30.
import type { CouncilInstitution, CouncilIssueCategory, CouncilRoutingDecision } from "./types.js";

type InstitutionProfile = {
  institution: CouncilInstitution;
  powers: string[];
  limits: string[];
  democraticChecks: string[];
};

export const COUNCIL_INSTITUTION_PROFILES: Record<CouncilInstitution, InstitutionProfile> = {
  mp_office: {
    institution: "mp_office",
    powers: [
      "Raise constituency issues with ministers and departments.",
      "Table written questions, ask oral questions, and pursue casework referrals.",
      "Campaign for policy and funding changes at national level.",
    ],
    limits: [
      "Cannot overrule council planning, licensing, or operational service decisions.",
      "Cannot direct council officers to make an individual case outcome.",
    ],
    democraticChecks: [
      "Accountable through Parliament and general elections.",
      "Works within parliamentary procedure and party discipline.",
    ],
  },
  local_council: {
    institution: "local_council",
    powers: [
      "Set local service priorities and budgets within legal constraints.",
      "Deliver statutory services such as housing, waste, social care, and highways (where applicable).",
      "Make local policy through full council and executive/cabinet decisions.",
    ],
    limits: [
      "Subject to statutory duties, ring-fenced funds, and borrowing rules.",
      "Cannot change national legislation or immigration/benefits law.",
    ],
    democraticChecks: [
      "Decisions scrutinised by opposition and scrutiny committees.",
      "Meetings and decisions can be challenged through complaints, ombudsman, and judicial review.",
    ],
  },
  planning_committee: {
    institution: "planning_committee",
    powers: [
      "Determine planning applications using local and national planning policy.",
      "Attach lawful planning conditions and obligations where justified.",
    ],
    limits: [
      "Members must avoid pre-determination and conflicts of interest.",
      "Cannot refuse or approve for irrelevant reasons outside planning law.",
    ],
    democraticChecks: [
      "Decisions are public and can be appealed or legally challenged.",
      "Members act quasi-judicially under code of conduct rules.",
    ],
  },
  licensing_committee: {
    institution: "licensing_committee",
    powers: [
      "Grant, vary, suspend, or revoke licences under licensing objectives.",
      "Impose proportionate conditions on licensed premises/activities.",
    ],
    limits: [
      "Must apply statutory licensing tests and evidence standards.",
      "Cannot use licensing powers to pursue unrelated political goals.",
    ],
    democraticChecks: [
      "Public hearings with rights for applicants and objectors.",
      "Appeal routes to magistrates court.",
    ],
  },
  scrutiny_committee: {
    institution: "scrutiny_committee",
    powers: [
      "Review executive decisions and policy implementation.",
      "Call-in decisions and request evidence from officers/cabinet members.",
    ],
    limits: [
      "Typically cannot directly implement executive actions.",
      "Operates within constitutional and statutory timelines.",
    ],
    democraticChecks: [
      "Improves transparency through evidence-led review.",
      "Provides minority parties a formal challenge route.",
    ],
  },
};

export const LEGAL_AND_FISCAL_CONSTRAINTS: string[] = [
  "Local Government Act 2000 governance and scrutiny framework applies.",
  "Localism Act 2011 powers are broad but still bounded by statute and budget.",
  "Section 114 constraints can restrict discretionary spending where councils are in financial distress.",
  "Ring-fenced grants and statutory duties limit budget flexibility.",
  "Pre-election periods and code of conduct rules can constrain political communication and decision framing.",
];

const ISSUE_ROUTING_HINTS: Array<{
  category: CouncilIssueCategory;
  keywords: string[];
  institutions: CouncilInstitution[];
  rationale: string;
}> = [
  {
    category: "planning",
    keywords: ["planning", "development", "application", "build", "green belt"],
    institutions: ["planning_committee", "local_council", "mp_office"],
    rationale: "Planning decisions are council-led; MPs can support by escalation on policy/systemic barriers.",
  },
  {
    category: "housing",
    keywords: ["housing", "homeless", "temporary accommodation", "mould", "landlord"],
    institutions: ["local_council", "scrutiny_committee", "mp_office"],
    rationale: "Housing duties are mostly local-authority functions with MP escalation for national blockers.",
  },
  {
    category: "transport",
    keywords: ["bus", "road", "pothole", "transport", "rail", "cycling"],
    institutions: ["local_council", "scrutiny_committee", "mp_office"],
    rationale: "Local transport delivery is council-led; MPs can escalate with central transport bodies.",
  },
  {
    category: "crime_asb",
    keywords: ["crime", "asb", "antisocial", "safety", "police"],
    institutions: ["local_council", "licensing_committee", "mp_office"],
    rationale: "Councils influence prevention and licensing; MPs escalate with police/government where needed.",
  },
];

export function classifyCouncilIssue(issue: string): CouncilIssueCategory {
  const normalized = issue.toLowerCase();
  const match = ISSUE_ROUTING_HINTS.find((item) => item.keywords.some((keyword) => normalized.includes(keyword)));
  return match?.category ?? "other";
}

export function routeIssueToInstitutions(issue: string): CouncilRoutingDecision {
  const issueCategory = classifyCouncilIssue(issue);
  const matched = ISSUE_ROUTING_HINTS.find((item) => item.category === issueCategory);
  const institutions = matched?.institutions ?? ["local_council", "mp_office"];
  const legalBoundaries = institutions.flatMap((institution) => COUNCIL_INSTITUTION_PROFILES[institution].limits);

  return {
    issueCategory,
    institutions,
    rationale: matched?.rationale ?? "Issue appears cross-cutting; local council delivery and MP escalation should be considered together.",
    legalBoundaries,
  };
}

