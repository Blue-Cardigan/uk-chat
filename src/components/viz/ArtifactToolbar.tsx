import { useMemo, useState } from "react";
import { Copy, Download, FileSpreadsheet, Image } from "lucide-react";
import { toPng } from "html-to-image";
import { Button } from "@/components/ui/primitives";
import type { VizPayload } from "@/lib/types";

function valueToCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  if (headers.length === 0) return "";
  const escaped = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, "\"\"")}"` : cell);
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escaped(valueToCell(row[header]))).join(",")),
  ];
  return lines.join("\n");
}

function maybeExtractRows(payload: VizPayload): Record<string, unknown>[] | null {
  if (payload.chartSpec?.data?.length) return payload.chartSpec.data;
  if (Array.isArray(payload.data)) {
    const rows = payload.data.filter(
      (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry),
    );
    return rows.length > 0 ? rows : null;
  }
  return null;
}

function triggerDownload(content: string, mimeType: string, fileName: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

type Props = {
  payload: VizPayload;
  targetRef?: React.RefObject<HTMLElement | null>;
  className?: string;
};

export function ArtifactToolbar({ payload, targetRef, className }: Props) {
  const [copiedState, setCopiedState] = useState<"json" | "csv" | null>(null);
  const [exportingPng, setExportingPng] = useState(false);
  const jsonText = useMemo(() => JSON.stringify(payload.data, null, 2), [payload.data]);
  const csvText = useMemo(() => {
    const rows = maybeExtractRows(payload);
    return rows ? rowsToCsv(rows) : "";
  }, [payload]);

  async function copyText(kind: "json" | "csv", value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedState(kind);
      window.setTimeout(() => setCopiedState((current) => (current === kind ? null : current)), 1600);
    } catch {
      // Clipboard can fail in restricted contexts.
    }
  }

  async function downloadPng() {
    if (!targetRef?.current) return;
    setExportingPng(true);
    try {
      const dataUrl = await toPng(targetRef.current, { cacheBust: true, pixelRatio: 2 });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `artifact-${payload.toolName}-${Date.now()}.png`;
      document.body.append(link);
      link.click();
      link.remove();
    } catch {
      // PNG export is best-effort.
    } finally {
      setExportingPng(false);
    }
  }

  return (
    <div className={className ?? "flex flex-wrap items-center gap-1"}>
      <Button
        type="button"
        variant="ghost"
        className="h-7 gap-1 rounded-md px-2 text-[11px]"
        aria-label="Copy artifact JSON"
        onClick={() => copyText("json", jsonText)}
      >
        <Copy className="h-3.5 w-3.5" />
        {copiedState === "json" ? "Copied" : "JSON"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="h-7 gap-1 rounded-md px-2 text-[11px]"
        aria-label="Download artifact JSON"
        onClick={() => triggerDownload(jsonText, "application/json;charset=utf-8", `artifact-${payload.toolName}-${Date.now()}.json`)}
      >
        <Download className="h-3.5 w-3.5" />
        JSON
      </Button>
      {csvText ? (
        <>
          <Button
            type="button"
            variant="ghost"
            className="h-7 gap-1 rounded-md px-2 text-[11px]"
            aria-label="Copy artifact CSV"
            onClick={() => copyText("csv", csvText)}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            {copiedState === "csv" ? "Copied" : "CSV"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-7 gap-1 rounded-md px-2 text-[11px]"
            aria-label="Download artifact CSV"
            onClick={() => triggerDownload(csvText, "text/csv;charset=utf-8", `artifact-${payload.toolName}-${Date.now()}.csv`)}
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
        </>
      ) : null}
      {targetRef?.current ? (
        <Button
          type="button"
          variant="ghost"
          className="h-7 gap-1 rounded-md px-2 text-[11px]"
          aria-label="Download artifact as PNG"
          onClick={() => {
            void downloadPng();
          }}
          disabled={exportingPng}
        >
          <Image className="h-3.5 w-3.5" />
          {exportingPng ? "Exporting" : "PNG"}
        </Button>
      ) : null}
    </div>
  );
}
