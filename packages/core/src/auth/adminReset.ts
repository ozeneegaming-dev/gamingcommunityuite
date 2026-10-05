import { randomInt } from "node:crypto";
import type { PrismaClient } from "@gcs/db";
import { writeAudit } from "../audit";
import { GcsForbidden, GcsNotFound } from "../errors";
import { hashPassword } from "./passwords";
import { normalizeUsername } from "./usernames";

/** Fără caractere ușor de confundat (0/O, 1/l/I). */
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.!@#";
const PASSWORD_LENGTH = 20;

/**
 * Recuperarea accesului (`gcs reset-admin-password <nume>`, din consola serverului): doar pentru un Root Admin.
 * Generează o parolă nouă (afișată o singură dată de CLI), dezactivează 2FA și șterge sesiunile userului.
 */
export async function resetRootPassword(db: PrismaClient, name: string): Promise<string> {
  const user = await db.user.findUnique({
    where: { nameNormalized: normalizeUsername(name) },
    select: { id: true, primaryGroup: { select: { key: true } }, groups: { select: { group: { select: { key: true } } } } },
  });
  if (!user) throw new GcsNotFound({ entity: "user" });
  const isRoot = user.primaryGroup.key === "root_admin" || user.groups.some((g) => g.group.key === "root_admin");
  if (!isRoot) throw new GcsForbidden({ reason: "not_root" });

  const password = Array.from({ length: PASSWORD_LENGTH }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join("");
  const hash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    const credential = await tx.account.findFirst({ where: { userId: user.id, providerId: "credential" } });
    if (credential) await tx.account.update({ where: { id: credential.id }, data: { password: hash } });
    else await tx.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash } });
    await tx.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false, lastAcpAuthAt: null, lastAcpAuthIp: null } });
    await tx.twoFactor.deleteMany({ where: { userId: user.id } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await writeAudit(tx, { actorId: null, action: "user.password_reset", targetType: "user", targetId: user.id, after: { via: "cli" }, ip: "cli" });
  });
  return password;
}
