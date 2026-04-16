function env(key: string): string | undefined {
  const maybeProcess = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return maybeProcess.process?.env?.[key];
}

const TOKEN_PREFIX = "enc:v1:";

function toBase64(bytes: Uint8Array): string {
  const maybeGlobal = globalThis as { btoa?: (value: string) => string };
  if (typeof maybeGlobal.btoa !== "function") {
    throw new Error("Base64 encoding unavailable in runtime");
  }
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return maybeGlobal.btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const maybeGlobal = globalThis as { atob?: (value: string) => string };
  if (typeof maybeGlobal.atob !== "function") {
    throw new Error("Base64 decoding unavailable in runtime");
  }
  const binary = maybeGlobal.atob(value);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    out[index] = binary.charCodeAt(index);
  }
  return out;
}

function getCryptoApi(): Crypto {
  if (typeof crypto !== "undefined" && crypto.subtle) return crypto;
  throw new Error("Web Crypto API unavailable in runtime");
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

async function getKey(): Promise<CryptoKey> {
  const encodedKey = env("MCP_TOKEN_ENCRYPTION_KEY")?.trim();
  if (!encodedKey) {
    throw new Error("MCP_TOKEN_ENCRYPTION_KEY is required — refusing to read/write MCP tokens without encryption");
  }
  const keyBytes = fromBase64(encodedKey);
  if (keyBytes.byteLength !== 32) {
    throw new Error("MCP_TOKEN_ENCRYPTION_KEY must be base64-encoded 32-byte key");
  }
  return getCryptoApi().subtle.importKey("raw", asArrayBuffer(keyBytes), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function assertMcpEncryptionConfigured(): void {
  const encodedKey = env("MCP_TOKEN_ENCRYPTION_KEY")?.trim();
  if (!encodedKey) {
    throw new Error("MCP_TOKEN_ENCRYPTION_KEY is required");
  }
  const keyBytes = fromBase64(encodedKey);
  if (keyBytes.byteLength !== 32) {
    throw new Error("MCP_TOKEN_ENCRYPTION_KEY must be base64-encoded 32-byte key");
  }
}

export async function encryptMcpToken(plaintext: string): Promise<string> {
  if (!plaintext) throw new Error("Cannot encrypt empty MCP token");
  const key = await getKey();
  const iv = new Uint8Array(getCryptoApi().getRandomValues(new Uint8Array(12)));
  const plainBytes = new TextEncoder().encode(plaintext);
  const cipherBuffer = await getCryptoApi().subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, asArrayBuffer(plainBytes));
  const cipherBytes = new Uint8Array(cipherBuffer);
  return `${TOKEN_PREFIX}${toBase64(iv)}:${toBase64(cipherBytes)}`;
}

export async function decryptMcpToken(payload: string | null | undefined): Promise<string | null> {
  if (!payload) return null;
  if (!payload.startsWith(TOKEN_PREFIX)) return payload;
  const key = await getKey();
  const encoded = payload.slice(TOKEN_PREFIX.length);
  const [ivB64, cipherB64] = encoded.split(":");
  if (!ivB64 || !cipherB64) return null;
  const iv = new Uint8Array(fromBase64(ivB64));
  const ciphertext = new Uint8Array(fromBase64(cipherB64));
  const plainBuffer = await getCryptoApi().subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, asArrayBuffer(ciphertext));
  return new TextDecoder().decode(plainBuffer);
}
