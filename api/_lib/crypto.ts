function env(key: string): string | undefined {
  const maybeProcess = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return maybeProcess.process?.env?.[key];
}

const TOKEN_PREFIX = "enc:v1:";

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"));
  const binary = atob(value);
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

async function getKey(): Promise<CryptoKey | null> {
  const encodedKey = env("MCP_TOKEN_ENCRYPTION_KEY")?.trim();
  if (!encodedKey) return null;
  const keyBytes = fromBase64(encodedKey);
  if (keyBytes.byteLength !== 32) {
    throw new Error("MCP_TOKEN_ENCRYPTION_KEY must be base64-encoded 32-byte key");
  }
  return getCryptoApi().subtle.importKey("raw", asArrayBuffer(keyBytes), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptMcpToken(plaintext: string): Promise<string | null> {
  if (!plaintext) return null;
  const key = await getKey();
  if (!key) return null;
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
  if (!key) return null;
  const encoded = payload.slice(TOKEN_PREFIX.length);
  const [ivB64, cipherB64] = encoded.split(":");
  if (!ivB64 || !cipherB64) return null;
  const iv = new Uint8Array(fromBase64(ivB64));
  const ciphertext = new Uint8Array(fromBase64(cipherB64));
  const plainBuffer = await getCryptoApi().subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, asArrayBuffer(ciphertext));
  return new TextDecoder().decode(plainBuffer);
}
