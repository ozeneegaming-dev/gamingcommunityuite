import { normalizeUsername, type GcsDemoContext } from "@gcs/core";
import { defaultChannelPermissions } from "./index";

/** Mesajele demo din shoutbox (macheta Main): autorul (`admin` = Root Admin-ul ales în wizard) și textul. */
const DEMO_SHOUTS: { author: "admin" | string; body: string }[] = [
  { author: "admin", body: "Bine ați venit în comunitate! Shoutbox-ul e deschis pentru toți membrii." },
  { author: "Krypt", body: "Salut tuturor! Cine intră diseară pe serverul de CS2?" },
  { author: "ShadowRO", body: "Eu sunt, după 21:00. Facem echipă?" },
  { author: "Krypt", body: "Sigur, vă aștept pe Discord." },
];

/** Camerele publice demo (etapa 5), pe lângă General. */
const DEMO_ROOMS = [
  { key: "offtopic", name: "Off-topic", description: "Orice altceva: muzică, filme, hardware." },
  { key: "lfg", name: "Caut echipă", description: "Găsește-ți coechipieri pentru meciurile de diseară." },
];

/**
 * Datele demo ale chat-ului: camerele publice Off-topic și „Caut echipă” (cu permisiunile implicite) și mesajele din
 * General. Idempotent: camerele existente și un canal cu mesaje rămân neatinse; „empty” nu creează nimic.
 */
export async function seedChatDemo(ctx: GcsDemoContext): Promise<void> {
  if (ctx.variant !== "demo") return;
  const { db } = ctx;
  const groupIds = new Map((await db.group.findMany({ select: { id: true, key: true } })).map((g) => [g.key, g.id]));
  for (const [i, room] of DEMO_ROOMS.entries()) {
    if (await db.chatChannel.findUnique({ where: { key: room.key } })) continue;
    await db.chatChannel.create({ data: { ...room, position: i + 1, retentionDays: 14 } });
    await db.containerPermission.createMany({ data: defaultChannelPermissions(groupIds, room.key), skipDuplicates: true });
  }
  const general = await db.chatChannel.findUnique({ where: { key: "general" } });
  if (!general || (await db.chatMessage.count({ where: { channelId: general.id } })) > 0) return;
  const admin = await db.user.findUnique({ where: { email: ctx.adminEmail.toLowerCase() }, select: { id: true } });
  const now = Date.now();
  const rows = [];
  for (const [i, shout] of DEMO_SHOUTS.entries()) {
    const author =
      shout.author === "admin" ? admin : await db.user.findFirst({ where: { nameNormalized: normalizeUsername(shout.author) }, select: { id: true } });
    if (!author) continue;
    // Recente (în retenția de 7 zile), în ordinea din listă.
    rows.push({ channelId: general.id, authorId: author.id, body: shout.body, createdAt: new Date(now - (DEMO_SHOUTS.length - i) * 4 * 60_000) });
  }
  await db.chatMessage.createMany({ data: rows });
}
