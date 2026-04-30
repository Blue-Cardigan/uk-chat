import type { streamText } from "ai";
import { isProviderInvalidRequestError, isProviderTimeoutError } from "./internals.js";
import { logError, logWarn } from "./logger.js";

function describeProviderError(error: unknown): {
  message: string;
  statusCode: number | null;
  responseBody: unknown;
  url: string | null;
  errorType: string | null;
} {
  const err = error as
    | {
        statusCode?: number;
        message?: string;
        url?: string;
        cause?: { statusCode?: number; responseBody?: unknown; message?: string; url?: string };
      }
    | null
    | undefined;
  const statusCode = err?.statusCode ?? err?.cause?.statusCode ?? null;
  const message = err?.message ?? err?.cause?.message ?? String(error);
  const responseBody = err?.cause?.responseBody ?? null;
  const url = err?.url ?? err?.cause?.url ?? null;
  const errorType =
    responseBody && typeof responseBody === "object"
      ? ((responseBody as { metadata?: { error_type?: string } }).metadata?.error_type ?? null)
      : null;
  return { message, statusCode, responseBody, url, errorType };
}

export type StreamTextResult = ReturnType<typeof streamText>;
export type StreamToolsValue = Parameters<typeof streamText>[0]["tools"];

export type TryStreamOptions = {
  includeFallbackModels: boolean;
  includeTools: boolean;
  requireToolCall: boolean;
  toolsOverride?: StreamToolsValue;
  systemOverride?: string;
  stepLimitOverride?: number;
};

export type TryStream = (options: TryStreamOptions) => StreamTextResult;

export type FallbackRunParams = {
  tryStream: TryStream;
  primary: TryStreamOptions;
  requireDataToolCall: boolean;
  quantitativeSafeTools: StreamToolsValue;
  quantitativeReducedSafeTools: StreamToolsValue;
  systemPrompt: string;
  quantMainStepLimit: number;
  modelId: string;
  providerModel: string;
  telemetry: Record<string, unknown>;
};

/**
 * Attempt `primary` via `tryStream`, then walk the fallback chain on
 * recoverable errors. Preserves existing telemetry.fallbackPath values
 * exactly so dashboards keep working.
 *
 * Chain:
 *   timeout:
 *     quantitative  → timeout_reduced_tools → timeout_bounded_synthesis
 *     non-quant     → timeout_no_tools_non_quant
 *   invalid_request:
 *     → no_fallback_models
 *     quantitative  → auto_tool_choice → reduced_tools → no_tools
 *     non-quant     → no_tools_non_quant
 */
export function runChatWithFallback(params: FallbackRunParams): StreamTextResult {
  const {
    tryStream,
    primary,
    requireDataToolCall,
    quantitativeSafeTools,
    quantitativeReducedSafeTools,
    systemPrompt,
    quantMainStepLimit,
    modelId,
    providerModel,
    telemetry,
  } = params;

  if (telemetry.fallbackPath === undefined) telemetry.fallbackPath = "none";

  try {
    return tryStream(primary);
  } catch (error) {
    if (isProviderTimeoutError(error)) {
      return handleTimeout(error);
    }
    if (!isProviderInvalidRequestError(error)) throw error;
    return handleInvalidRequest(error);
  }

  function handleTimeout(error: unknown): StreamTextResult {
    if (requireDataToolCall) {
      logWarn("[api/chat] Provider timed out, retrying with reduced quantitative tools", {
        modelId,
        providerModel,
        ...describeProviderError(error),
      });
      try {
        telemetry.fallbackPath = "timeout_reduced_tools";
        return tryStream({
          includeFallbackModels: false,
          includeTools: true,
          requireToolCall: true,
          toolsOverride: quantitativeReducedSafeTools,
          stepLimitOverride: Math.max(2, Math.min(4, quantMainStepLimit)),
          systemOverride: `${systemPrompt}\n\nTimeout recovery: run one lookup, one concrete data retrieval, then synthesize.`,
        });
      } catch (timeoutRetryError) {
        if (!isProviderTimeoutError(timeoutRetryError) && !isProviderInvalidRequestError(timeoutRetryError)) {
          throw timeoutRetryError;
        }
        telemetry.fallbackPath = "timeout_bounded_synthesis";
        return tryStream({ includeFallbackModels: false, includeTools: false, requireToolCall: false });
      }
    }
    telemetry.fallbackPath = "timeout_no_tools_non_quant";
    return tryStream({ includeFallbackModels: false, includeTools: false, requireToolCall: false });
  }

  function handleInvalidRequest(error: unknown): StreamTextResult {
    logWarn("[api/chat] Provider rejected request, retrying without fallback model chain", {
      modelId,
      providerModel,
      requireDataToolCall,
      ...describeProviderError(error),
    });

    try {
      telemetry.fallbackPath = "no_fallback_models";
      return tryStream({
        includeFallbackModels: false,
        includeTools: true,
        requireToolCall: requireDataToolCall,
      });
    } catch (retryError) {
      if (!isProviderInvalidRequestError(retryError)) throw retryError;

      if (!requireDataToolCall) {
        logWarn("[api/chat] Provider still rejected request, retrying without tools", {
          modelId,
          providerModel,
          ...describeProviderError(retryError),
        });
        telemetry.fallbackPath = "no_tools_non_quant";
        return tryStream({ includeFallbackModels: false, includeTools: false, requireToolCall: false });
      }

      logWarn("[api/chat] Provider rejected required tool choice, retrying with auto tool choice", {
        modelId,
        providerModel,
        ...describeProviderError(retryError),
      });
      try {
        telemetry.fallbackPath = "auto_tool_choice";
        return tryStream({ includeFallbackModels: false, includeTools: true, requireToolCall: false });
      } catch (autoToolChoiceError) {
        if (!isProviderInvalidRequestError(autoToolChoiceError)) throw autoToolChoiceError;

        logWarn("[api/chat] Provider still rejected request, retrying with reduced tool set", {
          modelId,
          providerModel,
          ...describeProviderError(autoToolChoiceError),
        });
        try {
          telemetry.fallbackPath = "reduced_tools";
          return tryStream({
            includeFallbackModels: false,
            includeTools: true,
            requireToolCall: true,
            toolsOverride: quantitativeSafeTools,
          });
        } catch (reducedToolError) {
          if (!isProviderInvalidRequestError(reducedToolError)) throw reducedToolError;
          telemetry.fallbackPath = "no_tools";
          return tryStream({ includeFallbackModels: false, includeTools: false, requireToolCall: false });
        }
      }
    }
  }
}
