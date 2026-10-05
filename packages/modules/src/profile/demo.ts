import { GcsAcpRoleService, GcsContentRenderer, GcsSearchIndex, normalizeUsername, type GcsDemoContext } from "@gcs/core";
import type { Prisma } from "@gcs/db";
import { GcsForumCounters } from "../forums/counters";
import { RENDER_LABELS } from "../forums/labels";
import { GcsAchievementService } from "./achievements";

type Tx = Prisma.TransactionClient;

/** Membrii demo din machete (Topic, Profil). Nu au parolă: nu se poate intra în conturile lor. */
const DEMO_MEMBERS = [
  {
    name: "Krypt",
    email: "krypt@demo.invalid",
    tier: "vip_legend",
    days: null,
    frame: "neon",
    bio: "Nu există lag, doar skill issue.",
    accent: "#B794FF",
    fields: { country: "România", platform: "PC", rank_cs2: "Premier 18.400", server: "RED-LINE RolePlay" },
    badges: [
      { key: "tournament_champion", reason: "Turneu CS2 2v2 — Septembrie" },
      { key: "rp_veteran", reason: "Doi ani de RolePlay pe server" },
    ],
    reply: "Bine v-am găsit! Ne vedem pe server diseară la turneul de CS2.",
  },
  {
    name: "ShadowRO",
    email: "shadowro@demo.invalid",
    tier: "vip_gold",
    days: 30,
    frame: "gold",
    bio: "AWP main, cafea multă.",
    accent: "#F4B740",
    fields: { country: "România", platform: "PC", rank_cs2: "Premier 14.200" },
    badges: [],
    reply: "Salutare tuturor! Caut echipă pentru turneele de weekend.",
  },
] as const;

const DEMO_FIELDS: Prisma.ProfileFieldCreateManyInput[] = [
  { key: "rank_cs2", label: "Rank CS2", type: "TEXT", section: "GAMES", maxLength: 40, showOnCard: true, position: 3 },
  { key: "server", label: "Server preferat", type: "TEXT", section: "ABOUT", maxLength: 60, position: 4 },
];

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

async function setFields(tx: Tx, userId: string, values: Record<string, string>): Promise<void> {
  const fields = await tx.profileField.findMany({ where: { key: { in: Object.keys(values) } }, select: { id: true, key: true } });
  for (const f of fields) {
    await tx.profileFieldValue.upsert({
      where: { userId_fieldId: { userId, fieldId: f.id } },
      create: { userId, fieldId: f.id, value: values[f.key]! },
      update: {},
    });
  }
}

/**
 * Datele demo ale etapei 3 (varianta „Date demo” din wizard): câmpurile Rank CS2 și Server preferat, profilul
 * Root Admin-ului (bio, accent, câmpuri, rama Fire) și doi membri VIP din machete (Krypt, ShadowRO) cu răspunsuri
 * în topicul de bun venit. Idempotent: membrii existenți nu se recreează.
 */
export async function seedProfileDemo(ctx: GcsDemoContext): Promise<void> {
  if (ctx.variant !== "demo") return;
  const { db, bus, registry } = ctx;
  await db.profileField.createMany({ data: DEMO_FIELDS, skipDuplicates: true });

  const admin = await db.user.findUnique({ where: { email: ctx.adminEmail.toLowerCase() } });
  const fire = await db.avatarFrame.findUnique({ where: { key: "fire" } });
  if (admin) {
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: admin.id },
        data: { bio: admin.bio || "Fondatorul comunității.", accentColor: admin.accentColor ?? "#D62839", avatarFrameId: admin.avatarFrameId ?? fire?.id ?? null },
      });
      await setFields(tx, admin.id, { country: "România", platform: "PC", server: "RED-LINE RolePlay" });
    });
  }

  const welcome = admin ? await db.topic.findFirst({ where: { authorId: admin.id }, orderBy: { id: "asc" } }) : null;
  const member = await db.group.findUniqueOrThrow({ where: { key: "member" } });
  const renderer = new GcsContentRenderer();
  const counters = new GcsForumCounters();
  const search = new GcsSearchIndex();
  const created: string[] = [];

  for (const m of DEMO_MEMBERS) {
    // Deja creat, sau numele e luat (ex. adminul și-a ales „Krypt” la instalare): membrul demo nu se creează.
    if (await db.user.findFirst({ where: { OR: [{ email: m.email }, { nameNormalized: normalizeUsername(m.name) }] } })) continue;
    const [tier, frame, badges] = await Promise.all([
      db.group.findUniqueOrThrow({ where: { key: m.tier } }),
      db.avatarFrame.findUnique({ where: { key: m.frame } }),
      db.badge.findMany({ where: { key: { in: m.badges.map((b) => b.key) } } }),
    ]);
    const userId = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: m.name,
          nameNormalized: normalizeUsername(m.name),
          email: m.email,
          emailVerified: true,
          primaryGroupId: tier.id,
          previousPrimaryGroupId: member.id,
          bio: m.bio,
          accentColor: m.accent,
          avatarFrameId: frame?.id ?? null,
          lastActiveAt: new Date(),
        },
      });
      const expiresAt = m.days === null ? null : new Date(Date.now() + m.days * 86_400_000);
      await tx.vipSubscription.create({ data: { userId: user.id, groupId: tier.id, expiresAt, madePrimary: true } });
      await tx.vipLog.create({ data: { userId: user.id, groupId: tier.id, action: "GRANT", expiresAt, note: "demo" } });
      await setFields(tx, user.id, m.fields);
      for (const b of badges) {
        const reason = m.badges.find((x) => x.key === b.key)?.reason ?? null;
        await tx.userBadge.create({ data: { userId: user.id, badgeId: b.id, reason } });
      }
      if (welcome) {
        const rendered = renderer.render(doc(m.reply), { embeds: [], siteHost: "localhost", labels: RENDER_LABELS.ro! });
        const post = await tx.post.create({
          data: { topicId: welcome.id, authorId: user.id, contentJson: rendered.json as Prisma.InputJsonValue, contentHtml: rendered.html, ip: "install" },
        });
        await search.indexPost(tx, post.id, rendered.text);
        await counters.onReply(tx, { postId: post.id, topicId: welcome.id, forumId: welcome.forumId, authorId: user.id, createdAt: post.createdAt }, true);
        await counters.recountUser(tx, user.id);
      }
      return user.id;
    });
    created.push(userId);
  }

  // Badge-urile automate, punctele și rangurile, ca pe un site real (fără coadă: instalarea nu are worker încă).
  const achievements = new GcsAchievementService({ db, bus, acp: new GcsAcpRoleService({ db, registry }), jobs: null });
  for (const id of [...created, ...(admin ? [admin.id] : [])]) await achievements.evaluate(id);
}
