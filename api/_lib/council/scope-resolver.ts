import type { CouncilResolvedGeography, CouncilScope } from "./types.js";
import { isRecord } from "../../../src/shared/type-guards.js";

type ToolMap = Record<string, unknown>;

function readText(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function callTool<T = unknown>(tools: ToolMap, name: string, args: Record<string, unknown>): Promise<T | null> {
  const tool = tools[name];
  if (!isRecord(tool) || typeof tool.execute !== "function") return null;
  try {
    const result = await (tool.execute as (input: Record<string, unknown>) => Promise<unknown>)(args);
    return result as T;
  } catch {
    return null;
  }
}

function normalizePostcode(postcode: string): string {
  return postcode.trim().replace(/\s+/g, "").toUpperCase();
}

export async function resolveCouncilScope(scope: CouncilScope, tools: ToolMap): Promise<CouncilResolvedGeography> {
  if (scope.kind === "national") {
    const nation = scope.nation ?? "uk";
    return {
      scope,
      displayName: nation === "uk" ? "United Kingdom" : nation[0]!.toUpperCase() + nation.slice(1).replace("_", " "),
      nation,
    };
  }

  if (scope.kind === "postcode") {
    const postcode = normalizePostcode(scope.postcode);
    const lookup = await callTool<unknown>(tools, "postcodes_lookup", { postcode });
    const record = isRecord(lookup) ? lookup : {};
    const constituencyName = readText(record, ["parliamentary_constituency", "constituency", "constituency_name"]);
    const constituencyCode = readText(record, ["parliamentary_constituency_code", "constituency_code", "pcon24cd"]);
    const localAuthorityName = readText(record, ["admin_district", "local_authority", "lad_name"]);
    const localAuthorityCode = readText(record, ["admin_district_code", "local_authority_code", "lad_code"]);
    const country = readText(record, ["country", "nation"]);
    return {
      scope,
      displayName: constituencyName ?? localAuthorityName ?? postcode,
      postcode,
      constituencyName,
      constituencyCode,
      localAuthorityName,
      localAuthorityCode,
      nation: country,
    };
  }

  const area = scope.area.trim();
  const geo = await callTool<unknown>(tools, "geo_convertCode", { input: area });
  const record = isRecord(geo) ? geo : {};
  const constituencyName = readText(record, ["constituency_name", "constituency"]);
  const constituencyCode = readText(record, ["constituency_code", "pcon24cd", "ons_id"]);
  const localAuthorityName = readText(record, ["local_authority_name", "lad_name", "authority_name"]);
  const localAuthorityCode = readText(record, ["local_authority_code", "lad_code", "authority_code"]);
  const country = readText(record, ["country", "nation"]);

  return {
    scope,
    displayName: constituencyName ?? localAuthorityName ?? area,
    constituencyName,
    constituencyCode,
    localAuthorityName,
    localAuthorityCode,
    nation: country,
  };
}

