import type { GcsSeedContext } from "@gcs/core";
import type { AchievementTrigger, Prisma } from "@gcs/db";
import { DEFAULT_FIELD_GROUPS, DEFAULT_GROUP_FIELDS, LEGACY_FIELD_GROUPS } from "./fieldGroups";

/** Rangurile implicite (specul etapei 3, §2): doar pe postări. Ordinea dă ierarhia. */
export const DEFAULT_RANKS = [
  { name: "Recrut", minPosts: 0 },
  { name: "Jucător", minPosts: 10 },
  { name: "Activ", minPosts: 50 },
  { name: "Veteran", minPosts: 250 },
  { name: "Elită", minPosts: 1000 },
  { name: "Legendă", minPosts: 3000 },
] as const;

/**
 * Badge-urile implicite: 8 automate (prin reguli, +10 puncte) și 2 manuale. Insigna (specul 2026-10-07-insigne-grafice,
 * §8.1): forma spune categoria, nivelul (metalul) treapta, culoarea emailul; aceeași grafică o primesc și instalările
 * existente prin migrația `20261022000000_badge_art`. `symbol` rămâne textul insignei dacă adminul scoate iconița.
 */
export const DEFAULT_BADGES = [
  { key: "first_post", name: "Primul post", symbol: "✎", color: "#5EA2FF", points: 10, artShape: "medal", artTier: "bronze", artIcon: "fa-solid fa-pen-nib" },
  { key: "posts_100", name: "100 postări", symbol: "C", color: "#5EA2FF", points: 10, artShape: "medal", artTier: "silver", artIcon: "fa-solid fa-comments" },
  { key: "posts_1000", name: "1000 postări", symbol: "1K", color: "#5EA2FF", points: 10, artShape: "medal", artTier: "gold", artIcon: "fa-solid fa-fire" },
  { key: "member_1y", name: "1 an membru", symbol: "1Y", color: "#26C6DA", points: 10, artShape: "shield", artTier: "silver", artIcon: "fa-solid fa-cake-candles" },
  { key: "member_3y", name: "3 ani membru", symbol: "3Y", color: "#26C6DA", points: 10, artShape: "shield", artTier: "gold", artIcon: "fa-solid fa-chess-rook" },
  { key: "reputation_100", name: "100 reputație", symbol: "+", color: "#3DDC97", points: 10, artShape: "hexagon", artTier: "silver", artIcon: "fa-solid fa-thumbs-up" },
  { key: "top_helper", name: "Top helper", symbol: "★", color: "#3DDC97", points: 10, artShape: "hexagon", artTier: "gold", artIcon: "fa-solid fa-handshake-angle" },
  { key: "vip", name: "VIP", symbol: "VIP", color: "#FF7AC6", points: 10, artShape: "diamond", artTier: "platinum", artIcon: "fa-solid fa-gem" },
  { key: "tournament_champion", name: "Campion turneu", symbol: "GG", color: "#FF6B74", points: 0, manual: true, artShape: "rosette", artTier: "gold", artIcon: "fa-solid fa-trophy" },
  { key: "rp_veteran", name: "Veteran RP", symbol: "RP", color: "#B794FF", points: 0, manual: true, artShape: "star", artTier: "custom", artIcon: "fa-solid fa-masks-theater" },
] as const;

type DefaultRule = { key: string; name: string; trigger: AchievementTrigger; threshold?: number; points?: number; badge?: string };

/** Regulile implicite: badge-urile automate (punctele vin din badge) și punctele pe acțiune (`EACH_*`). */
export const DEFAULT_RULES: DefaultRule[] = [
  { key: "first_post", name: "Primul post", trigger: "POSTS_COUNT", threshold: 1, badge: "first_post" },
  { key: "posts_100", name: "100 de postări", trigger: "POSTS_COUNT", threshold: 100, badge: "posts_100" },
  { key: "posts_1000", name: "1000 de postări", trigger: "POSTS_COUNT", threshold: 1000, badge: "posts_1000" },
  { key: "member_1y", name: "1 an de membru", trigger: "MEMBER_DAYS", threshold: 365, badge: "member_1y" },
  { key: "member_3y", name: "3 ani de membru", trigger: "MEMBER_DAYS", threshold: 1095, badge: "member_3y" },
  { key: "reputation_100", name: "100 de reputație", trigger: "REPUTATION", threshold: 100, badge: "reputation_100" },
  { key: "top_helper", name: "10 răspunsuri marcate rezolvare", trigger: "SOLUTIONS_COUNT", threshold: 10, badge: "top_helper" },
  { key: "vip", name: "Devine VIP", trigger: "IS_VIP", threshold: 1, badge: "vip" },
  { key: "each_post", name: "Puncte pentru fiecare postare", trigger: "EACH_POST", points: 1 },
  { key: "each_reaction", name: "Puncte pentru fiecare reacție pozitivă primită", trigger: "EACH_REACTION_RECEIVED", points: 1 },
  { key: "each_solution", name: "Puncte pentru fiecare răspuns marcat rezolvare", trigger: "EACH_SOLUTION", points: 5 },
];

export const DEFAULT_PROFILE_FIELDS: Prisma.ProfileFieldCreateManyInput[] = [
  // Etapa 5: iconițele (Font Awesome) și afișarea în postbit.
  { key: "country", label: "Țară", type: "TEXT", section: "ABOUT", maxLength: 60, showOnCard: true, position: 0, icon: "fa-solid fa-flag", showInPostbit: true },
  { key: "platform", label: "Platformă", type: "SELECT", options: ["PC", "PlayStation", "Xbox", "Mobil"], section: "ABOUT", position: 1, icon: "fa-solid fa-gamepad", showInPostbit: true },
  { key: "twitch", label: "Twitch", type: "URL", section: "GAMES", maxLength: 200, position: 2, icon: "fa-brands fa-twitch" },
];

const ADMIN_GROUPS = ["root_admin", "admin"];

/** Ramele din machete (Main, Topic, Profil). Disponibilitatea: specul etapei 3, §2. */
export const DEFAULT_FRAMES = [
  { key: "fire", name: "Fire", style: { colors: ["#FF3B3B", "#FF9F1C", "#FFE066"], width: 3, spin: true }, groups: ["vip_bronze", "vip_silver", "vip_gold", "vip_legend"] },
  { key: "gold", name: "Gold", style: { colors: ["#F4B740", "#FFF4CC", "#B97A0E"], width: 3, spin: true }, groups: ["vip_gold", "vip_legend"] },
  { key: "neon", name: "Neon", style: { colors: ["#22D3EE", "#B794FF", "#FF7AC6"], width: 4, glow: "#22D3EE", spin: true }, groups: ["vip_legend"] },
] as const;

/** Stilurile de nume pe care un VIP Gold / Legend le poate alege în locul stilului grupului. */
export const DEFAULT_NAME_STYLES = [
  { key: "ns_fire", name: "Fire", style: { gradient: ["#FF3B3B", "#FF9F1C", "#FFE066"], animated: true, bold: true } },
  { key: "ns_ice", name: "Ice", style: { gradient: ["#6FB6FF", "#D8F3FF", "#22D3EE"], animated: true, bold: true } },
  { key: "ns_neon", name: "Neon", style: { gradient: ["#22D3EE", "#B794FF", "#FF7AC6"], animated: true, glow: "#22D3EE", bold: true } },
] as const;
const NAME_STYLE_GROUPS = ["vip_gold", "vip_legend"];

/** Marcajul că rangurile implicite au fost create o dată (rangurile nu au cheie: fără marcaj, seed-ul nu știe ce a șters adminul). */
const RANKS_SEEDED = "seed.profile.ranks";
/** Marcajul grupurilor de câmpuri (profil gaming v2). */
const FIELD_GROUPS_SEEDED = "seed.profile.field_groups";

/** Datele implicite ale profilului. Idempotent: nu suprascrie și nu recreează ce s-a schimbat sau șters din ACP. */
export async function seedProfile({ tx, groupIds }: GcsSeedContext): Promise<void> {
  const ids = (keys: readonly string[]) => keys.map((k) => groupIds.get(k)).filter((id): id is number => id !== undefined);

  if (!(await tx.setting.findUnique({ where: { key: RANKS_SEEDED } }))) {
    if ((await tx.rank.count()) === 0) {
      await tx.rank.createMany({ data: DEFAULT_RANKS.map((r, position) => ({ ...r, position })) });
    }
    await tx.setting.create({ data: { key: RANKS_SEEDED, value: true } });
  }

  await tx.badge.createMany({
    data: DEFAULT_BADGES.map((b, position) => ({ ...b, position })),
    skipDuplicates: true,
  });
  const badges = new Map((await tx.badge.findMany({ select: { id: true, key: true } })).map((b) => [b.key, b.id]));
  await tx.achievementRule.createMany({
    data: DEFAULT_RULES.map((r, position) => ({
      key: r.key,
      name: r.name,
      trigger: r.trigger,
      threshold: r.threshold ?? 0,
      points: r.points ?? 0,
      badgeId: r.badge ? (badges.get(r.badge) ?? null) : null,
      position,
    })),
    skipDuplicates: true,
  });

  await tx.profileField.createMany({ data: DEFAULT_PROFILE_FIELDS, skipDuplicates: true });

  // Profil gaming v2: grupurile câmpurilor și câmpurile lor, o singură dată (ce șterge sau mută adminul rămâne așa).
  if (!(await tx.setting.findUnique({ where: { key: FIELD_GROUPS_SEEDED } }))) {
    await tx.profileFieldGroup.createMany({ data: DEFAULT_FIELD_GROUPS, skipDuplicates: true });
    const groups = new Map((await tx.profileFieldGroup.findMany({ select: { id: true, key: true } })).map((g) => [g.key, g.id]));
    await tx.profileField.createMany({
      data: DEFAULT_GROUP_FIELDS.map(({ group, ...f }) => ({ ...f, groupId: groups.get(group) ?? null })),
      skipDuplicates: true,
    });
    for (const [key, group] of Object.entries(LEGACY_FIELD_GROUPS)) {
      const groupId = groups.get(group);
      if (groupId !== undefined) await tx.profileField.updateMany({ where: { key, groupId: null }, data: { groupId } });
    }
    await tx.setting.create({ data: { key: FIELD_GROUPS_SEEDED, value: true } });
  }

  await tx.avatarFrame.createMany({
    data: DEFAULT_FRAMES.map((f, position) => ({
      key: f.key,
      name: f.name,
      kind: "CSS" as const,
      style: f.style,
      groupIds: ids([...f.groups, ...ADMIN_GROUPS]),
      position,
    })),
    skipDuplicates: true,
  });
  await tx.nameStyle.createMany({
    data: DEFAULT_NAME_STYLES.map((s, position) => ({
      key: s.key,
      name: s.name,
      style: s.style,
      groupIds: ids([...NAME_STYLE_GROUPS, ...ADMIN_GROUPS]),
      position,
    })),
    skipDuplicates: true,
  });
}
