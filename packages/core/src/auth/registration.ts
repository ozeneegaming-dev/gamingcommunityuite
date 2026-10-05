import { randomInt } from "node:crypto";
import type { PrismaClient } from "@gcs/db";
import { GcsValidationError } from "../errors";
import { normalizeEmail, normalizeUsername, validateUsername } from "./usernames";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVALID_USERNAME_CHARS = /[^\p{L}\p{N}_.-]/gu;
const MAX_RENAME_ATTEMPTS = 20;

export type GcsNewUserData = {
  name: string;
  nameNormalized: string;
  email: string;
  primaryGroupId: number;
};

type Db = Pick<PrismaClient, "user" | "group">;

/**
 * Pregătește datele unui user nou (folosit de hook-ul Better Auth la crearea userului):
 * validează numele și emailul, refuză duplicatele (`username_taken`, `email_taken`) și alege grupul:
 * `new_member` dacă se cere confirmarea emailului, altfel `member`.
 *
 * Cu `autoRename` (conturi create prin Discord/Steam, unde userul nu poate corecta un câmp),
 * un nume invalid sau luat e înlocuit cu o variantă liberă, ex. `krypt4821`.
 */
export async function prepareNewUser(
  db: Db,
  input: { name: string; email: string },
  opts: { emailConfirm: boolean; autoRename?: boolean },
): Promise<GcsNewUserData> {
  const email = normalizeEmail(input.email);
  let name = input.name.trim();
  const errors: Record<string, string> = {};

  if (opts.autoRename) {
    name = await freeUsername(db, name);
  } else {
    const nameError = validateUsername(name);
    if (nameError) errors.name = nameError;
  }
  if (!EMAIL.test(email)) errors.email = "email_invalid";
  if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);

  const nameNormalized = normalizeUsername(name);
  const [nameTaken, emailTaken] = await Promise.all([
    db.user.findUnique({ where: { nameNormalized }, select: { id: true } }),
    db.user.findUnique({ where: { email }, select: { id: true } }),
  ]);
  if (nameTaken) errors.name = "username_taken";
  if (emailTaken) errors.email = "email_taken";
  if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);

  const group = await db.group.findUniqueOrThrow({
    where: { key: opts.emailConfirm ? "new_member" : "member" },
    select: { id: true },
  });
  return { name, nameNormalized, email, primaryGroupId: group.id };
}

/** Un nume valid și liber, cât mai apropiat de `wanted`. */
async function freeUsername(db: Db, wanted: string): Promise<string> {
  let base = [...wanted.replace(INVALID_USERNAME_CHARS, "_")].slice(0, 20).join("");
  if ([...base].length < 3) base = `${base}_user`.slice(0, 20);

  const candidates = [base];
  for (let i = 0; i < MAX_RENAME_ATTEMPTS; i++) candidates.push(`${base}${randomInt(1000, 10000)}`);
  for (const candidate of candidates) {
    if (validateUsername(candidate)) continue;
    const taken = await db.user.findUnique({
      where: { nameNormalized: normalizeUsername(candidate) },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  throw new GcsValidationError({ name: "username_taken" });
}
