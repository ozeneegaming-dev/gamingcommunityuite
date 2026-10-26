import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { leadingZeroBits, parsePowToken, POW_VERSION, powInput, powToken, type GcsPowChallenge } from "./powShared";

export * from "./powShared";

/** Cât trăiește o provocare (formularul de înregistrare stă deschis câteva minute). */
export const POW_TTL_MS = 20 * 60_000;
export const POW_MIN_DIFFICULTY = 8;
export const POW_MAX_DIFFICULTY = 24;

const sign = (secret: string, challenge: string) => createHmac("sha256", secret).update(challenge).digest("hex");

/** O provocare nouă, semnată cu secretul serverului (fără stare: verificarea refolosește semnătura). */
export function createPowChallenge(secret: string, difficulty: number, now = Date.now()): GcsPowChallenge {
  const d = Math.min(POW_MAX_DIFFICULTY, Math.max(POW_MIN_DIFFICULTY, Math.round(difficulty)));
  const expiresAt = now + POW_TTL_MS;
  const challenge = `${POW_VERSION}.${expiresAt}.${d}.${randomBytes(12).toString("hex")}`;
  return { challenge, signature: sign(secret, challenge), difficulty: d, expiresAt };
}

export type GcsPowVerdict = { ok: true; challenge: string; expiresAt: number } | { ok: false; reason: "malformed" | "signature" | "expired" | "work" };

/**
 * Verifică un răspuns: semnătura (provocarea e a noastră, dificultatea nu a fost scăzută), expirarea și munca făcută.
 * Folosirea o singură dată o asigură apelantul (cheia `challenge` în cache până la `expiresAt`).
 */
export function verifyPowToken(secret: string, token: string, now = Date.now()): GcsPowVerdict {
  const parsed = parsePowToken(token);
  if (!parsed) return { ok: false, reason: "malformed" };
  const expected = Buffer.from(sign(secret, parsed.challenge), "hex");
  const given = Buffer.from(parsed.signature, "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "signature" };
  if (parsed.expiresAt <= now) return { ok: false, reason: "expired" };
  const hash = createHash("sha256").update(powInput(parsed.challenge, parsed.nonce)).digest();
  if (leadingZeroBits(hash) < parsed.difficulty) return { ok: false, reason: "work" };
  return { ok: true, challenge: parsed.challenge, expiresAt: parsed.expiresAt };
}

/** Rezolvarea pe server (teste, unelte): aceeași căutare ca în browser. */
export function solvePow(c: Pick<GcsPowChallenge, "challenge" | "signature" | "difficulty">): string {
  for (let nonce = 0; ; nonce++) {
    if (leadingZeroBits(createHash("sha256").update(powInput(c.challenge, nonce)).digest()) >= c.difficulty) return powToken(c, nonce);
  }
}
