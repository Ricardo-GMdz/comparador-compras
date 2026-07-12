// Clave de acceso compartida: firma/verificación de una cookie de sesión.
// Sin usuarios ni base: una sola clave (ACCESS_KEY) para un círculo de confianza.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Nombre de la cookie de sesión. */
export const COOKIE_NAME = "cc_auth";

/** Rutas que NO exige clave (login y directorio público). */
export const PUBLIC_PATHS: ReadonlySet<string> = new Set(["/api/login", "/api/publico"]);

/** Compara dos strings en tiempo constante (hashea a largo fijo antes). */
export function hashEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Firma HMAC del vencimiento con el secreto compartido. */
function sign(expMs: number, secret: string): string {
  return createHmac("sha256", secret).update(String(expMs)).digest("hex");
}

/** Arma el token `exp.firma`. */
export function makeToken(expMs: number, secret: string): string {
  return `${expMs}.${sign(expMs, secret)}`;
}

/** Verifica firma y vencimiento del token. */
export function verifyToken(
  token: string | undefined,
  secret: string,
  nowMs: number,
): boolean {
  if (!token) {
    return false;
  }
  const dot = token.indexOf(".");
  if (dot <= 0) {
    return false;
  }
  const exp = Number(token.slice(0, dot));
  const signature = token.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < nowMs) {
    return false;
  }
  return hashEqual(signature, sign(exp, secret));
}
