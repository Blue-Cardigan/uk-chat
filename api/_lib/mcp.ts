import { createMCPClient } from "@ai-sdk/mcp";

export type McpTransportType = "sse" | "http";
export type McpCandidate = { type: McpTransportType; url: string };
export type McpAttempt = { type: McpTransportType; url: string; error: string };

function parseHttpUrl(value: string | undefined | null): URL | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildMcpCandidates(configuredUrl: string): McpCandidate[] {
  const raw = configuredUrl.trim();
  const url = parseHttpUrl(raw);
  if (!url) {
    return [{ type: "sse", url: raw }];
  }

  const root = new URL(url.toString());
  root.pathname = root.pathname.replace(/\/+$/, "");
  const rootUrl = root.toString();
  const path = root.pathname;
  const looksLikeSse = /\/sse$/i.test(path);
  const looksLikeMcp = /\/mcp$/i.test(path);

  const candidates: McpCandidate[] = [];
  const seen = new Set<string>();
  const add = (type: McpTransportType, candidateUrl: string) => {
    const key = `${type}:${candidateUrl}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ type, url: candidateUrl });
  };

  add("sse", url.toString());
  add("http", url.toString());

  if (looksLikeSse) {
    const base = url.toString().replace(/\/sse\/?$/i, "");
    add("http", `${base}/mcp`);
    add("http", base);
  } else if (looksLikeMcp) {
    const base = url.toString().replace(/\/mcp\/?$/i, "");
    add("sse", `${base}/sse`);
    add("sse", base);
  } else {
    add("sse", `${rootUrl}/sse`);
    add("http", `${rootUrl}/mcp`);
    add("http", rootUrl);
  }

  return candidates;
}

export async function loadMcpToolsWithFallback(configuredUrl: string, token: string) {
  const candidates = buildMcpCandidates(configuredUrl);
  const attempts: McpAttempt[] = [];

  for (const candidate of candidates) {
    try {
      const mcpClient = await createMCPClient({
        transport: {
          type: candidate.type,
          url: candidate.url,
          headers: { Authorization: `Bearer ${token}` },
        },
      });
      const tools = await mcpClient.tools();
      return { tools, connectedVia: candidate, attempts };
    } catch (error) {
      attempts.push({
        type: candidate.type,
        url: candidate.url,
        error: errorMessage(error),
      });
    }
  }

  return { tools: null, connectedVia: null, attempts };
}

