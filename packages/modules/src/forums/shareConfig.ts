import type { GcsSettingDef, GcsSettingsService } from "@gcs/core";

/** Secțiunea ACP (ACP › Sistem › Promovare › Distribuire). */
export const SHARE_ACP_SECTION = "system.share";
export const SHARE_SETTING = "share.config";

/** Rețelele din meniul „Distribuie”, în ordinea afișării. */
export const GCS_SHARE_NETWORKS = ["x", "facebook", "whatsapp", "telegram", "reddit", "linkedin", "email"] as const;
export type GcsShareNetwork = (typeof GCS_SHARE_NETWORKS)[number];

export type GcsShareConfig = {
  /** Meniul „Distribuie” pe topicuri. */
  enabled: boolean;
  /** Rețelele afișate (în ordinea de mai sus). */
  networks: GcsShareNetwork[];
  /** Pe telefon, „Copiază linkul” deschide foaia de distribuire a sistemului. */
  nativeShare: boolean;
  /** Hashtag-urile adăugate la distribuirea pe X (fără `#`, separate prin virgulă). */
  hashtags: string;
};

export const DEFAULT_SHARE: GcsShareConfig = { enabled: true, networks: ["x", "facebook", "whatsapp", "telegram", "email"], nativeShare: true, hashtags: "" };

export function shareConfigError(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "invalid";
  const c = v as Partial<GcsShareConfig>;
  if (typeof c.enabled !== "boolean" || typeof c.nativeShare !== "boolean" || typeof c.hashtags !== "string") return "invalid";
  if (!Array.isArray(c.networks) || c.networks.some((n) => !(GCS_SHARE_NETWORKS as readonly string[]).includes(n))) return "invalid_choice";
  if (c.hashtags.length > 100 || !/^[\p{L}\p{N}_,\s]*$/u.test(c.hashtags)) return "invalid";
  return null;
}

export const shareSetting: GcsSettingDef = { key: SHARE_SETTING, type: "json", default: DEFAULT_SHARE, section: "share", labelKey: "settings.share.config", validate: shareConfigError };

export async function loadShareConfig(settings: Pick<GcsSettingsService, "get">): Promise<GcsShareConfig> {
  const v = await settings.get<GcsShareConfig | null>(SHARE_SETTING).catch(() => null);
  return v && shareConfigError(v) === null ? v : DEFAULT_SHARE;
}

/** Hashtag-urile curățate pentru parametrul `hashtags` al X (fără `#` și spații). */
export function shareHashtags(raw: string): string {
  return raw
    .split(",")
    .map((h) => h.trim().replace(/^#/, "").replace(/\s+/g, ""))
    .filter(Boolean)
    .slice(0, 5)
    .join(",");
}
