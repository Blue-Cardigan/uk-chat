import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const port = Number(process.env.API_PORT ?? 3000);
const workspaceRoot = process.cwd();
const apiRoot = resolve(workspaceRoot, "api");

function loadEnvFromWorkspace() {
  const envPath = resolve(workspaceRoot, ".env");
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
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function resolveApiModule(pathname: string): string | null {
  if (!pathname.startsWith("/api")) return null;
  const normalized = pathname.replace(/\/+$/, "") || "/api";
  const indexEntry = resolve(apiRoot, "index.ts");
  if (normalized === "/api") {
    return existsSync(indexEntry) ? indexEntry : null;
  }

  const exact = resolve(apiRoot, `.${normalized.slice(4)}.ts`);
  if (existsSync(exact)) return exact;

  const conversationsDynamic = normalized.match(/^\/api\/conversations\/[^/]+$/);
  if (conversationsDynamic) {
    const dynamicPath = resolve(apiRoot, "conversations/[id].ts");
    if (existsSync(dynamicPath)) return dynamicPath;
  }

  if (existsSync(indexEntry)) return indexEntry;

  return null;
}

function collectBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", rejectBody);
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  try {
    const method = (req.method ?? "GET").toUpperCase();
    if (method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const host = req.headers.host ?? `localhost:${port}`;
    const url = new URL(req.url ?? "/", `http://${host}`);
    const modulePath = resolveApiModule(url.pathname);

    if (!modulePath) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    const body = await collectBody(req);
    const webHeaders = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") {
        webHeaders.set(key, value);
      } else if (Array.isArray(value)) {
        webHeaders.set(key, value.join(","));
      }
    }

    const init: RequestInit = { method, headers: webHeaders };
    if (method !== "GET" && method !== "HEAD" && body.length > 0) {
      init.body = body;
    }

    const handlerModule = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
    const handler = handlerModule[method] as ((request: Request) => Promise<Response>) | undefined;

    if (!handler) {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: `Method ${method} not allowed` }));
      return;
    }

    const webRequest = new Request(url.toString(), init);
    const webResponse = await handler(webRequest);

    res.statusCode = webResponse.status;
    webResponse.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    if (!webResponse.body) {
      res.end();
      return;
    }

    const reader = webResponse.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      if (!res.write(value)) {
        await new Promise<void>((resolveDrain) => {
          res.once("drain", () => resolveDrain());
        });
      }
    }
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dev-api] request failed", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: message }));
  }
}

loadEnvFromWorkspace();

createServer((req, res) => {
  void handleRequest(req, res);
}).listen(port, () => {
  console.log(`[dev-api] ready on http://localhost:${port}`);
});
