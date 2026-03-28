import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
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
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function printUsage() {
  console.log(`Usage:
  npm run user:add -- --email user@example.com [--token MCP_TOKEN] [--no-email] [--rotate-token]
  npm run user:add -- user@example.com [--token MCP_TOKEN] [--no-email] [--rotate-token]

Flags:
  --email <email>   Email to onboard
  --token <token>   Optional token override (otherwise server issues/reuses)
  --no-email        Skip sending a magic-link email
  --rotate-token    Force issuing a fresh MCP token
  --api-url <url>   Base URL for API requests (defaults to APP_URL)
  --help            Show this help
`);
}

function parseArgs(argv) {
  const args = { email: "", token: undefined, help: false, sendEmail: true, rotateToken: false, apiUrl: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--rotate-token") {
      args.rotateToken = true;
      continue;
    }
    if (arg === "--no-email") {
      args.sendEmail = false;
      continue;
    }
    if (arg === "--email") {
      args.email = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg === "--token") {
      args.token = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg === "--api-url") {
      args.apiUrl = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (!arg.startsWith("--") && !args.email) {
      args.email = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function main() {
  loadEnvFromWorkspace();
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  const email = args.email.trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    printUsage();
    throw new Error("A valid email is required.");
  }

  const apiBase = (args.apiUrl || process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const bootstrapSecret = process.env.ADMIN_BOOTSTRAP_SECRET;

  if (!bootstrapSecret) {
    throw new Error("ADMIN_BOOTSTRAP_SECRET must be set in .env or environment.");
  }

  const response = await fetch(`${apiBase}/api/admin/onboard-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-bootstrap-secret": bootstrapSecret,
    },
    body: JSON.stringify({
      email,
      sendEmail: args.sendEmail,
      token: args.token,
      rotateToken: args.rotateToken,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status >= 500) {
      throw new Error(`Onboarding API failed at ${apiBase}. Is your local API server running (for example, vercel dev on :3000)?`);
    }
    const message = typeof payload?.error === "string" ? payload.error : "Onboarding request failed";
    throw new Error(message);
  }

  const message = typeof payload?.message === "string" ? payload.message : "User onboarded";
  console.log(message);
  console.log(JSON.stringify(payload?.meta ?? payload, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
