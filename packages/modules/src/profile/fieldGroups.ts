import type { Prisma } from "@gcs/db";

/**
 * Grupurile câmpurilor de profil (profil gaming v2 §3): ACP-ul definește grupurile (titlul, textul de ajutor, ordinea),
 * iar formularul „Editează profilul” și coloana profilului le arată în ordinea lor. Câmpurile fără grup cad în grupul
 * secțiunii vechi (Despre / Jocuri), ca instalările existente să nu piardă nimic.
 */

/** Grupurile implicite (cheile sunt stabile; titlurile și textele se pot schimba din ACP). */
export const DEFAULT_FIELD_GROUPS: (Prisma.ProfileFieldGroupCreateManyInput & { key: string })[] = [
  { key: "basic", label: "De bază", helper: "Ziua de naștere (anul e opțional) și câteva date despre tine.", icon: "fa-solid fa-id-card", position: 0 },
  { key: "about_me", label: "Despre mine", helper: "Serverul preferat al comunității și ce te descrie ca jucător.", icon: "fa-solid fa-user", position: 1 },
  { key: "gear", label: "Echipamentul meu", helper: "Cu ce joci: procesor, placă video, memorie, telefon, sistem, laptop.", icon: "fa-solid fa-computer", position: 2 },
  { key: "description", label: "Descriere", helper: "Câteva rânduri despre tine, formatate cu editorul.", icon: "fa-solid fa-align-left", position: 3 },
  { key: "contact", label: "Contact", helper: "Scrie doar numele de utilizator: linkul se construiește singur.", icon: "fa-solid fa-address-book", position: 4 },
];

/** Câmpurile implicite ale grupurilor noi (`group` = cheia grupului). */
export const DEFAULT_GROUP_FIELDS: (Omit<Prisma.ProfileFieldCreateManyInput, "groupId"> & { group: string })[] = [
  { group: "about_me", key: "favorite_server", label: "Server preferat", type: "SERVER_SELECT", maxLength: 80, position: 10, icon: "fa-solid fa-server", helper: "Alege unul dintre serverele comunității." },
  { group: "gear", key: "gear_cpu", label: "Procesor", type: "TEXT", maxLength: 80, position: 20, icon: "fa-solid fa-microchip" },
  { group: "gear", key: "gear_gpu", label: "Placă video", type: "TEXT", maxLength: 80, position: 21, icon: "fa-solid fa-display" },
  { group: "gear", key: "gear_ram", label: "Memorie RAM", type: "TEXT", maxLength: 40, position: 22, icon: "fa-solid fa-memory" },
  { group: "gear", key: "gear_phone", label: "Telefon", type: "TEXT", maxLength: 80, position: 23, icon: "fa-solid fa-mobile-screen" },
  { group: "gear", key: "gear_os", label: "Sistem de operare", type: "TEXT", maxLength: 60, position: 24, icon: "fa-brands fa-windows" },
  { group: "gear", key: "gear_laptop", label: "Laptop", type: "TEXT", maxLength: 80, position: 25, icon: "fa-solid fa-laptop" },
  { group: "description", key: "description", label: "Descriere", type: "TEXTAREA", maxLength: 2000, position: 30, icon: "fa-solid fa-align-left" },
  { group: "contact", key: "contact_youtube", label: "YouTube", type: "TEXT", maxLength: 64, position: 40, icon: "fa-brands fa-youtube", linkTemplate: "https://www.youtube.com/@{handle}", helper: "Doar handle-ul, fără @." },
  { group: "contact", key: "contact_instagram", label: "Instagram", type: "TEXT", maxLength: 64, position: 41, icon: "fa-brands fa-instagram", linkTemplate: "https://www.instagram.com/{handle}" },
  { group: "contact", key: "contact_tiktok", label: "TikTok", type: "TEXT", maxLength: 64, position: 42, icon: "fa-brands fa-tiktok", linkTemplate: "https://www.tiktok.com/@{handle}" },
  { group: "contact", key: "contact_x", label: "X", type: "TEXT", maxLength: 64, position: 43, icon: "fa-brands fa-x-twitter", linkTemplate: "https://x.com/{handle}" },
];

/** Câmpurile vechi mutate în grupurile noi la prima pornire (doar dacă nu au deja un grup). */
export const LEGACY_FIELD_GROUPS: Record<string, string> = { country: "basic", platform: "basic", twitch: "contact", rank_cs2: "about_me", server: "about_me" };

// ─── Handle-urile de contact ──────────────────────────────────────────────────────────────────────

const HANDLE = /^[A-Za-z0-9_.-]{1,64}$/;

/** Un șablon de link valid: https, cu `{handle}` o singură dată. */
export function isLinkTemplate(template: string): boolean {
  if (!/^https:\/\/[^\s"'<>]+$/.test(template) || template.split("{handle}").length !== 2) return false;
  return URL.canParse(template.replace("{handle}", "x"));
}

/**
 * Handle-ul curățat: fără `@` în față și fără adresa profilului lipită (membrul a copiat tot linkul), sau `null` dacă
 * rămân caractere nepermise.
 */
export function cleanHandle(raw: string): string | null {
  let v = raw.trim();
  const url = /^https?:\/\/[^/]+\/(?:@)?([^/?#]+)/i.exec(v);
  if (url) v = url[1]!;
  v = v.replace(/^@+/, "");
  return HANDLE.test(v) ? v : null;
}

/** Adresa construită din handle (`null` fără șablon sau cu un handle invalid). */
export function contactLink(template: string | null | undefined, handle: string): string | null {
  if (!template || !isLinkTemplate(template)) return null;
  const clean = cleanHandle(handle);
  return clean ? template.replace("{handle}", encodeURIComponent(clean)) : null;
}

// ─── Gruparea câmpurilor ──────────────────────────────────────────────────────────────────────────

export type GcsFieldGroupDef = { id: number; key: string; label: string; helper: string; icon: string | null; position: number };

/** Grupurile de rezervă pentru câmpurile fără grup (secțiunile vechi). */
export const SECTION_GROUP_KEYS = { ABOUT: "about_me", GAMES: "games" } as const;

/**
 * Câmpurile, pe grupuri, în ordinea grupurilor (apoi a câmpurilor). Un câmp fără grup (sau cu un grup șters) intră în
 * grupul secțiunii lui (`about_me` / `games`): dacă grupul nu există, se creează unul virtual, cu eticheta dată.
 * Grupurile goale nu apar.
 */
export function groupFields<F extends { groupId?: number | null; section: "ABOUT" | "GAMES"; position?: number }>(
  groups: readonly GcsFieldGroupDef[],
  fields: readonly F[],
  fallbackLabel: (section: "ABOUT" | "GAMES") => string,
): { group: GcsFieldGroupDef; fields: F[] }[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const out = new Map<string, { group: GcsFieldGroupDef; fields: F[] }>();
  const virtual = (section: "ABOUT" | "GAMES"): GcsFieldGroupDef => {
    const key = SECTION_GROUP_KEYS[section];
    return byKey.get(key) ?? { id: section === "ABOUT" ? -1 : -2, key, label: fallbackLabel(section), helper: "", icon: null, position: 1000 + (section === "ABOUT" ? 0 : 1) };
  };
  for (const f of fields) {
    const group = (f.groupId != null ? byId.get(f.groupId) : undefined) ?? virtual(f.section);
    const entry = out.get(group.key) ?? { group, fields: [] };
    entry.fields.push(f);
    out.set(group.key, entry);
  }
  return [...out.values()]
    .sort((a, b) => a.group.position - b.group.position || a.group.id - b.group.id)
    .map((e) => ({ ...e, fields: [...e.fields].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) }));
}

// ─── Completarea profilului ───────────────────────────────────────────────────────────────────────

export type GcsCompletionInput = {
  avatar: boolean;
  cover: boolean;
  bio: boolean;
  birthday: boolean;
  signature: boolean;
  linkedAccount: boolean;
  /** Câmpurile pe care membrul le poate completa (fără cele vizibile doar staff-ului) și dacă sunt completate. */
  fields: { key: string; filled: boolean }[];
};

export type GcsCompletion = { percent: number; done: number; total: number; missing: string[] };

/** Ponderile: avatarul și bio-ul contează dublu; câmpurile au împreună cel mult cât restul pașilor. */
const STEPS = [
  ["avatar", 2],
  ["bio", 2],
  ["cover", 1],
  ["birthday", 1],
  ["signature", 1],
  ["linkedAccount", 1],
] as const;

/**
 * Bara „Profil completat” din Setări → Prezentare generală: pașii de bază (avatar, bio, copertă, zi de naștere,
 * semnătură, un cont legat) și câmpurile de profil (împreună, cel mult 8 puncte). `missing` = primii pași de făcut.
 */
export function profileCompletion(input: GcsCompletionInput): GcsCompletion {
  let done = 0;
  let total = 0;
  const missing: string[] = [];
  for (const [key, weight] of STEPS) {
    total += weight;
    if (input[key]) done += weight;
    else missing.push(key);
  }
  if (input.fields.length > 0) {
    const weight = 8;
    const filled = input.fields.filter((f) => f.filled).length;
    total += weight;
    done += (filled / input.fields.length) * weight;
    if (filled < input.fields.length) missing.push("fields");
  }
  const percent = total === 0 ? 100 : Math.round((done / total) * 100);
  return { percent, done: Math.round(done * 100) / 100, total, missing };
}
