/**
 * Edge Runtime 可用的 HS256 JWT 校验（middleware 用）。
 * 不引 jose：jose 的 JWE 模块在 Edge Runtime 会触发 DecompressionStream 警告并让 build 退出码非 0。
 */

const enc = new TextEncoder();

function b64urlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson(input: string): Record<string, unknown> | null {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(input))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type EdgeSession = { id: string; name: string; role: string };

export async function verifySessionTokenEdge(
  token: string | undefined,
  secret: string | undefined,
): Promise<EdgeSession | null> {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const head = decodeJson(header);
  if (!head || head.alg !== "HS256") return null;

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlToBytes(signature),
    enc.encode(`${header}.${payload}`),
  );
  if (!valid) return null;

  const claims = decodeJson(payload);
  if (!claims) return null;
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  if (!sub) return null;

  const exp = typeof claims.exp === "number" ? claims.exp : 0;
  if (exp && exp * 1000 <= Date.now()) return null;

  return {
    id: sub,
    name: typeof claims.name === "string" ? claims.name : "",
    role: typeof claims.role === "string" ? claims.role : "doctor",
  };
}
