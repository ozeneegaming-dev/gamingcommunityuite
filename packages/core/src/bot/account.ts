import type { Prisma, PrismaClient } from "@gcs/db";
import { normalizeUsername } from "../auth/usernames";

/** Grupul sistem al botului (pastila „BOT”); protejat, fără pagină de membri. */
export const BOT_GROUP_KEY = "bot";
/** Adresa contului-bot: domeniul `.invalid` nu primește emailuri și nu se leagă niciodată de un cont Discord / Google. */
export const BOT_EMAIL = "community-bot@bot.invalid";
export const BOT_DEFAULT_NAME = "Botul comunității";

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Contul-bot al site-ului (unul singur): creat de seed la instalare și la prima pornire a unui site existent. Fără parolă
 * (niciun rând `account`), deci nu se poate autentifica; numele implicit, sau următorul liber dacă e luat.
 */
export async function ensureCommunityBot(tx: Tx, botGroupId: number): Promise<string> {
  const existing = await tx.user.findFirst({ where: { isBot: true }, select: { id: true } });
  if (existing) return existing.id;
  let name = BOT_DEFAULT_NAME;
  for (let i = 2; await tx.user.findUnique({ where: { nameNormalized: normalizeUsername(name) }, select: { id: true } }); i++) {
    name = `${BOT_DEFAULT_NAME} ${i}`;
  }
  const user = await tx.user.create({
    data: { name, nameNormalized: normalizeUsername(name), email: BOT_EMAIL, primaryGroupId: botGroupId, isBot: true },
    select: { id: true },
  });
  return user.id;
}

/** Id-ul contului-bot, sau `null` (bază fără seed). */
export async function communityBotId(db: Tx): Promise<string | null> {
  return (await db.user.findFirst({ where: { isBot: true }, select: { id: true } }))?.id ?? null;
}

/** Dacă un user e contul-bot (verificarea de la autentificare și de la acțiunile din ACP). */
export async function isBotUser(db: Tx, userId: string): Promise<boolean> {
  return (await db.user.findUnique({ where: { id: userId }, select: { isBot: true } }))?.isBot === true;
}
