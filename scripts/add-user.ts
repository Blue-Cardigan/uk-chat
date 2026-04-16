import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Env } from "../api/env.js";
import { onboardUser } from "../api/_lib/onboarding.js";

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
  npm run user:add -- --email user@example.com [--token MCP_TOKEN] [--no-email] [--rotate-token] [--app-url https://chatgb.co.uk]
  npm run user:add -- user@example.com [--token MCP_TOKEN] [--no-email] [--rotate-token] [--app-url https://chatgb.co.uk]

Flags:
  --email <email>   Email to onboard
  --token <token>   Optional token override (otherwise server issues/reuses)
  --no-email        Skip sending a magic-link email
  --rotate-token    Force issuing a fresh MCP token
  --app-url <url>   App URL used for magic-link redirect (defaults to INVITE_APP_URL or https://chatgb.co.uk)
  --help            Show this help
`);
}

type Args = {
  email: string;
  token?: string;
  help: boolean;
  sendEmail: boolean;
  rotateToken: boolean;
  appUrl: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { email: "", token: undefined, help: false, sendEmail: true, rotateToken: false, appUrl: "" };
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
    if (arg === "--app-url") {
      args.appUrl = argv[i + 1] ?? "";
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

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function buildEnv(): Env {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`${key} must be set in .env or environment.`);
    }
  }
  return process.env as unknown as Env;
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

  const appUrl = (args.appUrl || process.env.INVITE_APP_URL || "https://chatgb.co.uk").replace(/\/$/, "");
  const env = buildEnv();

  const result = await onboardUser(
    {
      email,
      sendEmail: args.sendEmail,
      token: args.token,
      rotateToken: args.rotateToken,
      appUrl,
    },
    env,
  );

  console.log("User onboarding completed");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
