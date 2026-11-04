import type { Prisma, PrismaClient } from "@gcs/db";
import type { GcsModuleRegistry } from "../modules/registry";
import type { GcsLicense } from "./license";

/**
 * Aplicațiile alese la instalare (pasul „Aplicații”, decizia proprietarului 2026-10-09):
 * - **standard** (în pachetul de bază): Forum (mereu pornit), Galerie, Descărcări, Pagini, Clanuri, Calendar, Chat, VIP clasic;
 * - **premium** (vândute separat): Servere, Magazin, Studio VIP, Chat Pro, Grupuri Pro, Recrutare, doar dacă licența le include.
 * În wizard apar doar aplicațiile care există în această versiune (modulele înregistrate).
 * Aplicațiile nebifate se instalează OPRITE (tabelele există, aplicația e oprită) și se pot porni din ACP › Aplicații.
 */
export type GcsInstallAppTier = "standard" | "premium";
export type GcsInstallCatalogEntry = { key: string; tier: GcsInstallAppTier; locked?: true };

export const GCS_INSTALL_APP_CATALOG: readonly GcsInstallCatalogEntry[] = [
  { key: "forums", tier: "standard", locked: true },
  { key: "gallery", tier: "standard" },
  { key: "downloads", tier: "standard" },
  { key: "pages", tier: "standard" },
  { key: "clans", tier: "standard" },
  { key: "calendar", tier: "standard" },
  { key: "chat", tier: "standard" },
  { key: "vip", tier: "standard" },
  { key: "servers", tier: "premium" },
  { key: "shop", tier: "premium" },
  { key: "vip_studio", tier: "premium" },
  { key: "chat_pro", tier: "premium" },
  { key: "groups_pro", tier: "premium" },
  // Pluginul premium `gcs.recruitment` (Marketplace): pornește doar dacă licența îl include.
  { key: "recruitment", tier: "premium" },
];

/** Cheile aplicațiilor premium (din catalog). */
export const GCS_PREMIUM_APPS = GCS_INSTALL_APP_CATALOG.filter((a) => a.tier === "premium").map((a) => a.key);

/**
 * Pachetul (plugin `.gcs`) al unei aplicații premium, ex. `gcs.vip_studio`: pe disc se dezarhivează în `applications/`,
 * nu în `plugins/` (structura instalării Lite).
 */
export const isPremiumAppPackage = (pluginKey: string): boolean => pluginKey.startsWith("gcs.") && GCS_PREMIUM_APPS.includes(pluginKey.slice(4));

export type GcsInstallAppChoice = {
  key: string;
  tier: GcsInstallAppTier;
  labelKey: string;
  icon: string;
  descriptionKey: string | null;
  /** Forumul: mereu pornit, nu se poate debifa. */
  locked: boolean;
  /** Se poate bifa: aplicațiile standard și cele premium incluse în licență. */
  available: boolean;
  /** Poate fi aplicația de pornire (are o pagină de pornire). */
  canLand: boolean;
  requires: string[];
};

/** Aplicațiile din wizard: cele din catalog care există în registry, cu starea lor față de licență. */
export function installAppChoices(registry: GcsModuleRegistry, license: Pick<GcsLicense, "apps"> | null): GcsInstallAppChoice[] {
  const out: GcsInstallAppChoice[] = [];
  for (const entry of GCS_INSTALL_APP_CATALOG) {
    const app = registry.module(entry.key)?.app;
    if (!app) continue;
    // Doar Forumul e blocat aici; alte aplicații blocate (nucleul) nu apar în listă.
    if (!app.optional && !entry.locked) continue;
    out.push({
      key: entry.key,
      tier: entry.tier,
      labelKey: app.labelKey,
      icon: app.icon,
      descriptionKey: app.descriptionKey ?? null,
      locked: entry.locked === true,
      available: entry.tier === "standard" || (license?.apps.includes(entry.key) ?? false),
      canLand: !!app.landing,
      requires: app.requires ?? [],
    });
  }
  return out;
}

export type GcsAppSelection = {
  /** Aplicațiile opționale pornite. */
  enabled: string[];
  /** Aplicațiile opționale instalate oprite. */
  disabled: string[];
  /** Aplicația de pornire (cheia modulului; Forumul = aplicația „acasă”). */
  landing: string;
};

export type GcsAppSelectionError = "premium_not_licensed" | "requires" | "landing_invalid" | "unknown_app";

/** Alegerea din wizard → starea fiecărei aplicații (validată față de licență, dependențe și aplicația de pornire). */
export function resolveAppSelection(
  registry: GcsModuleRegistry,
  license: Pick<GcsLicense, "apps"> | null,
  input: { selected: readonly string[]; landing: string },
): { ok: true; selection: GcsAppSelection } | { ok: false; error: GcsAppSelectionError; app?: string } {
  const choices = installAppChoices(registry, license);
  const byKey = new Map(choices.map((c) => [c.key, c]));
  const picked = new Set<string>();
  for (const key of input.selected) {
    const choice = byKey.get(key);
    if (!choice) return { ok: false, error: "unknown_app", app: key };
    if (!choice.available) return { ok: false, error: "premium_not_licensed", app: key };
    picked.add(key);
  }
  for (const c of choices) if (c.locked) picked.add(c.key);
  // O dependență oprită face aplicația inactivă: pornirea cere dependențele bifate (ex. Chat Pro → Chat).
  for (const key of picked) {
    for (const dep of byKey.get(key)?.requires ?? []) {
      if (byKey.has(dep) && !picked.has(dep)) return { ok: false, error: "requires", app: key };
    }
  }
  const landing = input.landing || choices.find((c) => c.locked)?.key || "";
  const landingChoice = byKey.get(landing);
  if (!landingChoice?.canLand || !picked.has(landing)) return { ok: false, error: "landing_invalid", app: landing };
  const optional = choices.filter((c) => !c.locked);
  return {
    ok: true,
    selection: {
      enabled: optional.filter((c) => picked.has(c.key)).map((c) => c.key),
      disabled: optional.filter((c) => !picked.has(c.key)).map((c) => c.key),
      landing,
    },
  };
}

/** Aplică alegerea: un rând `apps` pentru fiecare aplicație opțională (idempotent, suprascrie seed-ul implicit). */
export async function applyAppSelection(db: PrismaClient | Prisma.TransactionClient, selection: GcsAppSelection): Promise<void> {
  for (const key of selection.enabled) await db.app.upsert({ where: { key }, create: { key, enabled: true }, update: { enabled: true } });
  for (const key of selection.disabled) await db.app.upsert({ where: { key }, create: { key, enabled: false }, update: { enabled: false } });
}

/** Valoarea setării `apps.landing`: `""` pentru aplicația „acasă” (Forumul randează `/`). */
export function landingSettingValue(registry: GcsModuleRegistry, landing: string): string {
  return registry.module(landing)?.app?.landing?.home ? "" : landing;
}
