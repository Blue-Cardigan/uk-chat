import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";

export const SUPPORTED_DOCUMENT_EXTENSIONS = ["pdf", "txt", "md", "markdown", "csv", "json", "docx", "xlsx"] as const;
export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_COUNT = 8;
export const MAX_DOCUMENT_TEXT_CHARS = 30_000;
export const MAX_TOTAL_DOCUMENT_TEXT_CHARS = 90_000;

const SUPPORTED_EXTENSION_SET = new Set<string>(SUPPORTED_DOCUMENT_EXTENSIONS);
const SUPPORTED_MIME_TYPES = new Set<string>([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/csv",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
]);

export type ParsedDocument = {
  id: string;
  name: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  extractedText: string;
  pageCount?: number;
  sheetNames?: string[];
};

export type ParsedDocumentFailure = {
  name: string;
  error: string;
};

export type ParsedDocumentWarning = {
  name: string;
  message: string;
};

export type ParseDocumentsResult = {
  documents: ParsedDocument[];
  failures: ParsedDocumentFailure[];
  warnings: ParsedDocumentWarning[];
};

let workerConfigured = false;

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function getExtension(fileName: string): string {
  const segments = fileName.toLowerCase().split(".");
  return segments.length > 1 ? (segments.at(-1) ?? "") : "";
}

function shorten(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

function getStableFileId(file: File, index: number): string {
  const normalizedName = file.name.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  return `${index + 1}-${normalizedName}-${file.size}-${file.lastModified}`;
}

function validateFile(file: File): string | null {
  const extension = getExtension(file.name);
  const mimeType = file.type.toLowerCase();
  if (!SUPPORTED_EXTENSION_SET.has(extension)) {
    return "Unsupported file extension.";
  }
  if (mimeType && !SUPPORTED_MIME_TYPES.has(mimeType)) {
    return `Unsupported MIME type: ${mimeType}`;
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    return `File too large (max ${Math.round(MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024))}MB).`;
  }
  return null;
}

async function parsePdf(file: File): Promise<{ text: string; pageCount: number }> {
  if (!workerConfigured) {
    GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    workerConfigured = true;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data: bytes }).promise;
  const chunks: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => {
        if (typeof item !== "object" || item == null) return "";
        const maybeText = (item as { str?: unknown }).str;
        return typeof maybeText === "string" ? maybeText : "";
      })
      .join(" ");
    if (pageText.trim()) chunks.push(`Page ${pageNumber}\n${pageText}`);
  }
  return { text: chunks.join("\n\n"), pageCount: pdf.numPages };
}

async function parseDocx(file: File): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

async function parseXlsx(file: File): Promise<{ text: string; sheetNames: string[] }> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheetTexts = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return "";
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
    if (!csv) return "";
    return `Sheet: ${sheetName}\n${csv}`;
  }).filter(Boolean);
  return { text: sheetTexts.join("\n\n"), sheetNames: workbook.SheetNames };
}

async function parsePlainText(file: File): Promise<string> {
  return file.text();
}

async function parseFile(file: File, extension: string): Promise<ParsedDocument> {
  const base: ParsedDocument = {
    id: "",
    name: file.name,
    extension,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    extractedText: "",
  };

  if (extension === "pdf") {
    const { text, pageCount } = await parsePdf(file);
    return { ...base, extractedText: text, pageCount };
  }
  if (extension === "docx") {
    const text = await parseDocx(file);
    return { ...base, extractedText: text };
  }
  if (extension === "xlsx") {
    const { text, sheetNames } = await parseXlsx(file);
    return { ...base, extractedText: text, sheetNames };
  }

  const text = await parsePlainText(file);
  return { ...base, extractedText: text };
}

export async function parseDocuments(files: File[]): Promise<ParseDocumentsResult> {
  const documents: ParsedDocument[] = [];
  const failures: ParsedDocumentFailure[] = [];
  const warnings: ParsedDocumentWarning[] = [];

  const selectedFiles = files.slice(0, MAX_DOCUMENT_COUNT);
  if (files.length > MAX_DOCUMENT_COUNT) {
    failures.push({
      name: "Some files",
      error: `Only ${MAX_DOCUMENT_COUNT} files can be uploaded at once.`,
    });
  }

  let totalChars = 0;
  for (const [index, file] of selectedFiles.entries()) {
    const validationError = validateFile(file);
    if (validationError) {
      failures.push({ name: file.name, error: validationError });
      continue;
    }
    const extension = getExtension(file.name);
    try {
      const parsed = await parseFile(file, extension);
      const normalizedText = normalizeWhitespace(parsed.extractedText);
      if (!normalizedText) {
        failures.push({ name: file.name, error: "No readable text found in this file." });
        continue;
      }
      const perDocLimited = shorten(normalizedText, MAX_DOCUMENT_TEXT_CHARS);
      if (perDocLimited.length < normalizedText.length) {
        warnings.push({
          name: file.name,
          message: `Truncated to ${MAX_DOCUMENT_TEXT_CHARS.toLocaleString()} characters (per-document limit).`,
        });
      }
      const remaining = Math.max(0, MAX_TOTAL_DOCUMENT_TEXT_CHARS - totalChars);
      if (remaining === 0) {
        failures.push({ name: file.name, error: "Total extracted text limit reached." });
        continue;
      }
      const textForPayload = shorten(perDocLimited, remaining);
      if (textForPayload.length < perDocLimited.length) {
        warnings.push({
          name: file.name,
          message: `Further truncated — total document text limit (${MAX_TOTAL_DOCUMENT_TEXT_CHARS.toLocaleString()} chars) reached.`,
        });
      }
      totalChars += textForPayload.length;
      documents.push({
        ...parsed,
        id: getStableFileId(file, index),
        extractedText: textForPayload,
      });
    } catch (error) {
      failures.push({
        name: file.name,
        error: error instanceof Error ? error.message : "Failed to parse this file.",
      });
    }
  }

  return { documents, failures, warnings };
}
