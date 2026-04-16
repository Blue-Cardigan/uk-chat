import { jsonSchema } from "ai";
import { isRecord } from "./internals.js";

export const PROVIDER_TOOL_NAME_MAX_LENGTH = 128;
export const PROVIDER_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export const CREATE_CHART_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["type", "title", "xField", "yFields", "data"],
  properties: {
    type: { type: "string", enum: ["line", "bar", "scatter", "area", "pie", "table"] },
    title: { type: "string" },
    xField: { type: "string" },
    yFields: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
    labelField: { type: "string" },
    groupField: { type: "string" },
    data: {
      type: "array",
      maxItems: 160,
      items: {
        type: "object",
        additionalProperties: true,
      },
    },
    sources: { type: "array", items: { type: "string" } },
    note: { type: "string" },
  },
};

export type ToolSchemaProjectionRule = {
  toolNames: string[];
  removeProperties: string[];
  removeKindEnumValues?: string[];
};

export const WEAK_MODEL_TOOL_SCHEMA_PROJECTION_RULES: ToolSchemaProjectionRule[] = [
  {
    toolNames: ["parliament_fetchHansard"],
    removeProperties: ["baseUrl"],
  },
  {
    toolNames: ["osm_assets"],
    removeProperties: ["endpoint"],
  },
  {
    toolNames: ["desnz_fetchCo2"],
    removeProperties: ["url"],
    removeKindEnumValues: ["custom_csv"],
  },
  {
    toolNames: ["finance_laRevenue"],
    removeProperties: ["url"],
    removeKindEnumValues: ["custom_csv"],
  },
];

export const MODELS_NEEDING_SCHEMA_PROJECTION = new Set<string>([
  // Sonnet 4.6 does NOT need projection — strong tool-calling model.
  // Add "sonnet" here only if the slot is reassigned to a weaker model.
]);

export function isSchemaWrapper(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return "validate" in value || "jsonSchema" in value || "~standard" in value;
}

export function inferArrayItemsFromPath(path: string[]): Record<string, unknown> {
  const key = path[path.length - 1]?.toLowerCase() ?? "";
  if (key === "bbox") return { type: "number" };
  if (key.includes("record")) return { type: "object", additionalProperties: true };
  return { type: "string" };
}

export function inferTupleItemsSchema(items: unknown[]): Record<string, unknown> {
  const schemaTypes = items
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => item.type)
    .filter((value): value is string => typeof value === "string");
  if (schemaTypes.length === 0) return { type: "string" };
  if (schemaTypes.every((kind) => kind === "integer" || kind === "number")) return { type: "number" };
  if (schemaTypes.every((kind) => kind === "string")) return { type: "string" };
  return { type: "string" };
}

export function normalizeToolSchemaInPlace(node: unknown, path: string[] = []): boolean {
  let changed = false;

  if (Array.isArray(node)) {
    for (const item of node) {
      if (normalizeToolSchemaInPlace(item, path)) changed = true;
    }
    return changed;
  }
  if (!isRecord(node)) return false;

  for (const unionKey of ["anyOf", "oneOf", "allOf"] as const) {
    const unionValue = node[unionKey];
    if (!Array.isArray(unionValue) || unionValue.length === 0) continue;
    const preferred = unionValue.find((entry) => isRecord(entry)) ?? unionValue[0];
    if (isRecord(preferred)) {
      for (const [key, value] of Object.entries(preferred)) {
        if (node[key] === undefined) node[key] = value;
      }
    }
    delete node[unionKey];
    changed = true;
  }

  if (Array.isArray(node.prefixItems)) {
    if (node.items === undefined) {
      node.items = inferTupleItemsSchema(node.prefixItems);
    }
    delete node.prefixItems;
    changed = true;
  }

  if (Array.isArray(node.items)) {
    node.items = inferTupleItemsSchema(node.items);
    changed = true;
  }
  if (node.type === "array" && !isRecord(node.items)) {
    node.items = inferArrayItemsFromPath(path);
    changed = true;
  }

  for (const [key, value] of Object.entries(node)) {
    if (normalizeToolSchemaInPlace(value, [...path, key])) changed = true;
  }

  return changed;
}

export function normalizeToolSchemas<T extends Record<string, unknown>>(tools: T): {
  normalizedTools: T;
  normalizedToolNames: string[];
} {
  const entries: Array<[string, unknown]> = [];
  const normalizedToolNames: string[] = [];

  for (const [toolName, toolDefinition] of Object.entries(tools)) {
    if (!isRecord(toolDefinition)) {
      entries.push([toolName, toolDefinition]);
      continue;
    }
    const schemaKey = isRecord(toolDefinition.parameters)
      ? "parameters"
      : isRecord(toolDefinition.inputSchema)
        ? "inputSchema"
        : null;
    if (!schemaKey) {
      entries.push([toolName, toolDefinition]);
      continue;
    }

    const schemaValue = toolDefinition[schemaKey];
    const isInputSchemaWrapper = schemaKey === "inputSchema" && isSchemaWrapper(schemaValue);
    const toolCopy: Record<string, unknown> = { ...toolDefinition };

    if (isInputSchemaWrapper) {
      const wrapper = schemaValue as Record<string, unknown>;
      let rawSchema: unknown = wrapper.jsonSchema;
      try {
        rawSchema = structuredClone(rawSchema);
      } catch {
        // Keep original schema object if clone fails.
      }
      const changed = normalizeToolSchemaInPlace(rawSchema, [toolName, schemaKey, "jsonSchema"]);
      if (changed) {
        const validate = typeof wrapper.validate === "function" ? (wrapper.validate as (value: unknown) => unknown) : undefined;
        toolCopy[schemaKey] = jsonSchema(
          rawSchema as Record<string, unknown>,
          // jsonSchema<T> narrows validate to T; we preserve the original
          // validator across a generic boundary we can't name.
          validate ? { validate: validate as never } : undefined,
        );
        normalizedToolNames.push(toolName);
      } else {
        toolCopy[schemaKey] = schemaValue;
      }
      entries.push([toolName, toolCopy]);
      continue;
    }

    let schemaCopy: unknown = schemaValue;
    try {
      schemaCopy = structuredClone(schemaValue);
    } catch {
      // Keep original schema object if clone fails.
    }
    const changed = normalizeToolSchemaInPlace(schemaCopy, [toolName, schemaKey]);
    toolCopy[schemaKey] = schemaCopy;
    if (changed) normalizedToolNames.push(toolName);
    entries.push([toolName, toolCopy]);
  }

  return { normalizedTools: Object.fromEntries(entries) as T, normalizedToolNames };
}

export function projectToolSchemaForRule(schema: unknown, rule: ToolSchemaProjectionRule): boolean {
  if (!isRecord(schema)) return false;

  let changed = false;
  const schemaProperties = isRecord(schema.properties) ? (schema.properties as Record<string, unknown>) : null;

  if (schemaProperties) {
    for (const propertyName of rule.removeProperties) {
      if (propertyName in schemaProperties) {
        delete schemaProperties[propertyName];
        changed = true;
      }
    }
  }

  const required = Array.isArray(schema.required) ? schema.required : null;
  if (required) {
    const filteredRequired = required.filter(
      (entry): entry is string => typeof entry === "string" && !rule.removeProperties.includes(entry),
    );
    if (filteredRequired.length !== required.length) {
      schema.required = filteredRequired;
      changed = true;
    }
  }

  if (rule.removeKindEnumValues && schemaProperties && isRecord(schemaProperties.kind)) {
    const removeKindEnumValues = rule.removeKindEnumValues;
    const kindSchema = schemaProperties.kind as Record<string, unknown>;
    const enumValues = Array.isArray(kindSchema.enum) ? kindSchema.enum : null;
    if (enumValues) {
      const filteredEnumValues = enumValues.filter(
        (entry): entry is string => typeof entry === "string" && !removeKindEnumValues.includes(entry),
      );
      if (filteredEnumValues.length !== enumValues.length) {
        kindSchema.enum = filteredEnumValues;
        changed = true;
      }
      if (typeof kindSchema.default === "string" && removeKindEnumValues.includes(kindSchema.default)) {
        const fallbackDefault = filteredEnumValues.find((entry) => typeof entry === "string");
        if (fallbackDefault !== undefined) {
          kindSchema.default = fallbackDefault;
        } else {
          delete kindSchema.default;
        }
        changed = true;
      }
    }
  }

  return changed;
}

export function projectToolSchemasForModel<T extends Record<string, unknown>>(
  tools: T,
  modelId: string,
): { projectedTools: T; projectedToolNames: string[] } {
  if (!MODELS_NEEDING_SCHEMA_PROJECTION.has(modelId)) {
    return { projectedTools: tools, projectedToolNames: [] };
  }

  const rulesByToolName = new Map<string, ToolSchemaProjectionRule>();
  for (const rule of WEAK_MODEL_TOOL_SCHEMA_PROJECTION_RULES) {
    for (const toolName of rule.toolNames) rulesByToolName.set(toolName, rule);
  }

  const entries: Array<[string, unknown]> = [];
  const projectedToolNames: string[] = [];

  for (const [toolName, toolDefinition] of Object.entries(tools)) {
    const rule = rulesByToolName.get(toolName);
    if (!rule || !isRecord(toolDefinition)) {
      entries.push([toolName, toolDefinition]);
      continue;
    }

    const schemaKey = isRecord(toolDefinition.parameters)
      ? "parameters"
      : isRecord(toolDefinition.inputSchema)
        ? "inputSchema"
        : null;
    if (!schemaKey) {
      entries.push([toolName, toolDefinition]);
      continue;
    }

    const schemaValue = toolDefinition[schemaKey];
    const toolCopy: Record<string, unknown> = { ...toolDefinition };
    const isInputSchemaWrap = schemaKey === "inputSchema" && isSchemaWrapper(schemaValue);

    if (isInputSchemaWrap && isRecord(schemaValue)) {
      const wrapper = schemaValue as Record<string, unknown>;
      let rawSchema: unknown = wrapper.jsonSchema;
      try {
        rawSchema = structuredClone(rawSchema);
      } catch {
        // Keep original schema object if clone fails.
      }
      const changed = projectToolSchemaForRule(rawSchema, rule);
      if (changed) {
        const validate = typeof wrapper.validate === "function" ? (wrapper.validate as (value: unknown) => unknown) : undefined;
        toolCopy[schemaKey] = jsonSchema(
          rawSchema as Record<string, unknown>,
          // jsonSchema<T> narrows validate to T; we preserve the original
          // validator across a generic boundary we can't name.
          validate ? { validate: validate as never } : undefined,
        );
        projectedToolNames.push(toolName);
      } else {
        toolCopy[schemaKey] = schemaValue;
      }
      entries.push([toolName, toolCopy]);
      continue;
    }

    let schemaCopy: unknown = schemaValue;
    try {
      schemaCopy = structuredClone(schemaValue);
    } catch {
      // Keep original schema object if clone fails.
    }
    const changed = projectToolSchemaForRule(schemaCopy, rule);
    if (changed) {
      projectedToolNames.push(toolName);
    }
    toolCopy[schemaKey] = schemaCopy;
    entries.push([toolName, toolCopy]);
  }

  return { projectedTools: Object.fromEntries(entries) as T, projectedToolNames };
}

export function toProviderSafeToolName(name: string): string {
  const normalized = name.trim().replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");
  const fallback = normalized || "tool";
  return fallback.slice(0, PROVIDER_TOOL_NAME_MAX_LENGTH);
}

export function buildProviderSafeTools<T extends Record<string, unknown>>(tools: T): {
  safeTools: T;
  safeToOriginal: Map<string, string>;
  renamedPairs: Array<{ original: string; safe: string }>;
} {
  const safeToOriginal = new Map<string, string>();
  const renamedPairs: Array<{ original: string; safe: string }> = [];
  const entries: Array<[string, unknown]> = [];
  const usedNames = new Set<string>();

  for (const [originalName, definition] of Object.entries(tools)) {
    let safeName = PROVIDER_TOOL_NAME_PATTERN.test(originalName) ? originalName : toProviderSafeToolName(originalName);
    let suffix = 2;
    while (usedNames.has(safeName) || !PROVIDER_TOOL_NAME_PATTERN.test(safeName)) {
      const suffixText = `_${suffix}`;
      const baseLength = Math.max(1, PROVIDER_TOOL_NAME_MAX_LENGTH - suffixText.length);
      safeName = `${toProviderSafeToolName(originalName).slice(0, baseLength)}${suffixText}`;
      suffix += 1;
    }
    usedNames.add(safeName);
    safeToOriginal.set(safeName, originalName);
    if (safeName !== originalName) renamedPairs.push({ original: originalName, safe: safeName });
    entries.push([safeName, definition]);
  }

  return {
    safeTools: Object.fromEntries(entries) as T,
    safeToOriginal,
    renamedPairs,
  };
}
