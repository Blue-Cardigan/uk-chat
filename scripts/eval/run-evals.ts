// Eval harness driver.
//
// Authenticates as a configured admin user (jethro by default) by minting a
// Supabase JWT via the admin API, then fires each golden prompt at the
// deployed worker, parses the SSE stream, and asserts on the outcome.
//
// Usage:
//   pnpm run eval                 # all prompts, 2x concurrency
//   pnpm run eval -- --id <id>    # single prompt
//   pnpm run eval -- --against http://localhost:8787   # local worker
//   pnpm run eval -- --json       # machine-readable summary

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { GOLDEN_PROMPTS, type GoldenAssertion, type GoldenPrompt } from "./golden-prompts.ts";

type RunResult = {
  prompt: GoldenPrompt;
  passed: boolean;
  failures: string[];
  attempts: number;
  durationMs: number;
  toolCalls: string[];
  rawText: string;
  hasChartArtifact: boolean;
  hasSynthesizedError: boolean;
};

function loadEnvFromWorkspace() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseArgs(): { id?: string; against: string; json: boolean } {
  const args = process.argv.slice(2);
  let id: string | undefined;
  let against = "https://chatgb.co.uk";
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--id") id = args[++i];
    else if (arg === "--against") against = args[++i];
    else if (arg === "--json") json = true;
  }
  return { id, against, json };
}

async function mintEvalSession(env: NodeJS.ProcessEnv): Promise<{ accessToken: string; userId: string; conversationId: string; mcpToken: string }> {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = env.EVAL_USER_EMAIL ?? "jethro.reeve@gmail.com";
  if (!supabaseUrl || !serviceRole) {
    throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set in .env");
  }
  // Look up user by email
  const lookup = await fetch(`${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(adminEmail)}`, {
    headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
  });
  if (!lookup.ok) throw new Error(`Failed to look up eval user: ${lookup.status}`);
  const lookupJson = (await lookup.json()) as { users?: Array<{ id: string }> };
  const userId = lookupJson.users?.[0]?.id;
  if (!userId) throw new Error(`Eval user "${adminEmail}" not found`);
  // Mint a session (admin generate-link gives us tokens for service-side use)
  const sessionResp = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}`, "content-type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: adminEmail }),
  });
  if (!sessionResp.ok) throw new Error(`Failed to mint session: ${sessionResp.status}`);
  // Better: call signInWithOtp via service role's user-impersonation. Supabase
  // doesn't expose that directly; we use the admin generate_link endpoint
  // which returns the underlying token in `properties.action_link` query
  // params. Parse those out.
  const json = (await sessionResp.json()) as { action_link?: string; properties?: { action_link?: string } };
  const actionLink = json.action_link ?? json.properties?.action_link;
  if (!actionLink) throw new Error("No action_link returned from admin/generate_link");
  // Visit the action link to swap for an access token
  const actionUrl = new URL(actionLink);
  const verifyResp = await fetch(actionLink, { redirect: "manual" });
  // Supabase redirects to redirect_to with #access_token=... in the fragment.
  // That fragment isn't sent to the redirect target; we need to parse the
  // Location header.
  const location = verifyResp.headers.get("location");
  if (!location) throw new Error("No Location header on verify redirect");
  const tokenFragment = location.split("#")[1] ?? "";
  const fragmentParams = new URLSearchParams(tokenFragment);
  const accessToken = fragmentParams.get("access_token");
  if (!accessToken) throw new Error(`No access_token in redirect: ${location.slice(0, 200)}`);

  // Look up the conversation row to use; create one if needed
  const baseUrl = env.EVAL_AGAINST ?? "https://chatgb.co.uk";
  const convResp = await fetch(`${baseUrl}/api/conversations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ title: `eval ${new Date().toISOString()}` }),
  });
  if (!convResp.ok) throw new Error(`Failed to create conversation: ${convResp.status}`);
  const convJson = (await convResp.json()) as { id: string };

  // Fetch profile to get mcpToken
  const profileResp = await fetch(`${baseUrl}/api/account/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profileResp.ok) throw new Error(`Failed to load profile: ${profileResp.status}`);
  const profileJson = (await profileResp.json()) as { mcpToken: string };

  return { accessToken, userId, conversationId: convJson.id, mcpToken: profileJson.mcpToken };
}

type ChatResponseSummary = {
  rawText: string;
  toolCalls: string[];
  hasChartArtifact: boolean;
  hasSynthesizedError: boolean;
};

async function fireChatPrompt(
  prompt: GoldenPrompt,
  session: { accessToken: string; mcpToken: string },
  baseUrl: string,
): Promise<ChatResponseSummary> {
  // Each prompt gets its own fresh conversation so prior turns don't pollute.
  const convResp = await fetch(`${baseUrl}/api/conversations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ title: `eval/${prompt.id}` }),
  });
  if (!convResp.ok) throw new Error(`Conversation create failed: ${convResp.status}`);
  const conv = (await convResp.json()) as { id: string };

  const reqBody = {
    conversationId: conv.id,
    mcpToken: session.mcpToken,
    modelId: prompt.modelId ?? null,
    documents: [],
    artifactContext: [],
    id: `eval-${prompt.id}-${Date.now()}`,
    messages: [{ role: "user", parts: [{ type: "text", text: prompt.prompt }], id: "u1" }],
    trigger: "submit-message",
  };
  const resp = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(reqBody),
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`Chat request failed: ${resp.status}`);
  }
  // Drain the SSE stream as text
  const text = await resp.text();
  const events = text.split("\n\n").filter(Boolean);

  const toolCalls = new Set<string>();
  let rawText = "";
  let hasChartArtifact = false;
  let hasSynthesizedError = false;
  for (const event of events) {
    const dataLine = event.split("\n").find((l) => l.startsWith("data: "));
    if (!dataLine) continue;
    const payload = dataLine.slice(6);
    if (payload === "[DONE]") continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = parsed.type as string | undefined;
    if (type === "tool-input-available") {
      const tn = (parsed.toolName ?? parsed.tool_name) as string | undefined;
      if (tn) toolCalls.add(tn);
    } else if (typeof type === "string" && type.startsWith("tool-") && !type.includes("-input")) {
      // chunks like `tool-create_chart` carry toolCallId/state/output
      const tn = type.slice("tool-".length).split("-")[0];
      if (tn === "create_chart" || tn) toolCalls.add(tn);
    }
    if (type === "text-delta" && typeof parsed.delta === "string") {
      rawText += parsed.delta;
    } else if (type === "text" && typeof parsed.text === "string") {
      rawText += parsed.text;
    }
    if (type === "tool-output-available" && (parsed.toolName === "create_chart" || (parsed.toolCallId as string)?.toString().includes("create_chart"))) {
      hasChartArtifact = true;
    }
    const output = parsed.output;
    if (output && typeof output === "object" && (output as { synthesized?: boolean }).synthesized === true) {
      hasSynthesizedError = true;
    }
  }
  // Heuristic: if the rawText mentions a chart was rendered, count it
  if (!hasChartArtifact && /chart (above|below)/i.test(rawText)) hasChartArtifact = true;
  return { rawText, toolCalls: [...toolCalls], hasChartArtifact, hasSynthesizedError };
}

function checkAssertion(assertion: GoldenAssertion, summary: ChatResponseSummary): string | null {
  switch (assertion.kind) {
    case "tool_called":
      return summary.toolCalls.includes(assertion.toolName)
        ? null
        : `expected tool_called(${assertion.toolName}), got [${summary.toolCalls.join(", ")}]`;
    case "tool_not_called":
      return summary.toolCalls.includes(assertion.toolName)
        ? `expected tool_not_called(${assertion.toolName}) but it was`
        : null;
    case "chart_rendered":
      return summary.hasChartArtifact ? null : "expected chart_rendered, none found";
    case "text_contains": {
      const haystack = assertion.caseInsensitive ? summary.rawText.toLowerCase() : summary.rawText;
      const needle = assertion.caseInsensitive ? assertion.needle.toLowerCase() : assertion.needle;
      return haystack.includes(needle) ? null : `expected text_contains(${assertion.needle})`;
    }
    case "text_matches":
      return new RegExp(assertion.pattern, "i").test(summary.rawText) ? null : `expected text_matches(/${assertion.pattern}/i)`;
    case "no_synthesized_error":
      return summary.hasSynthesizedError ? "found synthesized error envelope (orphan tool call?)" : null;
    case "min_tool_calls":
      return summary.toolCalls.length >= assertion.count
        ? null
        : `expected ≥ ${assertion.count} tool calls, got ${summary.toolCalls.length}`;
    case "max_tool_calls":
      return summary.toolCalls.length <= assertion.count
        ? null
        : `expected ≤ ${assertion.count} tool calls, got ${summary.toolCalls.length}`;
    default:
      return `unknown assertion kind: ${(assertion as { kind: string }).kind}`;
  }
}

async function runOne(
  prompt: GoldenPrompt,
  session: { accessToken: string; mcpToken: string },
  baseUrl: string,
): Promise<RunResult> {
  const maxAttempts = prompt.flaky ? 3 : 1;
  const start = Date.now();
  let attempt = 0;
  let lastSummary: ChatResponseSummary | null = null;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const summary = await fireChatPrompt(prompt, session, baseUrl);
      lastSummary = summary;
      const failures = prompt.assertions
        .map((a) => checkAssertion(a, summary))
        .filter((f): f is string => f !== null);
      if (failures.length === 0) {
        return {
          prompt,
          passed: true,
          failures: [],
          attempts: attempt,
          durationMs: Date.now() - start,
          toolCalls: summary.toolCalls,
          rawText: summary.rawText.slice(0, 500),
          hasChartArtifact: summary.hasChartArtifact,
          hasSynthesizedError: summary.hasSynthesizedError,
        };
      }
      if (attempt >= maxAttempts) {
        return {
          prompt,
          passed: false,
          failures,
          attempts: attempt,
          durationMs: Date.now() - start,
          toolCalls: summary.toolCalls,
          rawText: summary.rawText.slice(0, 500),
          hasChartArtifact: summary.hasChartArtifact,
          hasSynthesizedError: summary.hasSynthesizedError,
        };
      }
    } catch (error) {
      if (attempt >= maxAttempts) {
        return {
          prompt,
          passed: false,
          failures: [`runtime error: ${error instanceof Error ? error.message : String(error)}`],
          attempts: attempt,
          durationMs: Date.now() - start,
          toolCalls: lastSummary?.toolCalls ?? [],
          rawText: lastSummary?.rawText.slice(0, 500) ?? "",
          hasChartArtifact: lastSummary?.hasChartArtifact ?? false,
          hasSynthesizedError: lastSummary?.hasSynthesizedError ?? false,
        };
      }
    }
  }
  // Unreachable
  return {
    prompt,
    passed: false,
    failures: ["loop exit"],
    attempts: attempt,
    durationMs: Date.now() - start,
    toolCalls: [],
    rawText: "",
    hasChartArtifact: false,
    hasSynthesizedError: false,
  };
}

async function main() {
  loadEnvFromWorkspace();
  const args = parseArgs();
  process.env.EVAL_AGAINST = args.against;

  const subset = args.id
    ? GOLDEN_PROMPTS.filter((p) => p.id === args.id)
    : GOLDEN_PROMPTS;
  if (subset.length === 0) {
    console.error(`No prompts matched id "${args.id}"`);
    process.exit(2);
  }

  console.log(`Eval target: ${args.against}`);
  console.log(`Running ${subset.length} prompt(s)...`);
  const session = await mintEvalSession(process.env);

  // Concurrency 2 to be polite to upstream APIs
  const results: RunResult[] = [];
  const queue = [...subset];
  async function worker() {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      const result = await runOne(next, session, args.against);
      results.push(result);
      const status = result.passed ? "✓" : "✗";
      console.log(`${status} [${result.prompt.id}] ${result.durationMs}ms${result.attempts > 1 ? ` (${result.attempts} attempts)` : ""}`);
      if (!result.passed) {
        for (const failure of result.failures) {
          console.log(`    ${failure}`);
        }
      }
    }
  }
  await Promise.all([worker(), worker()]);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} passed; ${failed} failed`);

  if (args.json) {
    console.log(JSON.stringify({ passed, failed, results }, null, 2));
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("eval driver crashed:", error);
  process.exit(2);
});
