import type { GcsSettingDef, GcsSettingsService } from "@gcs/core";

/** Regulile comunității: setarea, pagina publică și secțiunea ACP (ACP → Setări → Reguli comunitate). */
export const COMMUNITY_RULES_SETTING = "rules.content";
export const RULES_HREF = "/rules";
export const COMMUNITY_RULES_ACP_SECTION = "system.settings_rules";
const MAX_HTML = 200_000;

/**
 * Regulile publicate: documentul editorului (ca la postări), HTML-ul produs de același randator (validat și sanitizat)
 * și momentul ultimei salvări. `null` = fără reguli.
 */
export type GcsCommunityRules = { doc: Record<string, unknown>; html: string; updatedAt: string };

export function isCommunityRules(v: unknown): v is GcsCommunityRules {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    !!r.doc &&
    typeof r.doc === "object" &&
    !Array.isArray(r.doc) &&
    typeof r.html === "string" &&
    r.html.length <= MAX_HTML &&
    typeof r.updatedAt === "string" &&
    !Number.isNaN(Date.parse(r.updatedAt))
  );
}

export const communityRulesSetting: GcsSettingDef = {
  key: COMMUNITY_RULES_SETTING,
  type: "json",
  default: null,
  section: "rules",
  labelKey: "settings.rules.content",
  validate: (v) => (v === null || isCommunityRules(v) ? null : "invalid"),
};

/** Regulile publicate sau `null` (lipsă sau goale): pagina arată atunci o stare goală, iar meniul ascunde itemul. */
export async function communityRules(settings: Pick<GcsSettingsService, "get">): Promise<GcsCommunityRules | null> {
  const value = await settings.get<unknown>(COMMUNITY_RULES_SETTING);
  return isCommunityRules(value) && value.html.trim() !== "" ? value : null;
}
