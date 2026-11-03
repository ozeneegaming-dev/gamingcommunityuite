import type { GcsSettingDef, GcsSettingsService } from "@gcs/core";
import { isGcsIcon } from "@gcs/ui/icon-registry";

/** Secțiunea ACP (ACP › Sistem › Descoperire › Fluxuri). */
export const STREAMS_ACP_SECTION = "system.streams";
export const STREAMS_SETTING = "streams.config";

/** Ce poate apărea într-un flux de activitate. */
export const GCS_STREAM_KINDS = ["topic", "reply", "status", "member"] as const;
export type GcsStreamKind = (typeof GCS_STREAM_KINDS)[number];

/** Un flux propriu: un tab în plus pe pagina Activitate, cu tipurile și forumurile lui. */
export type GcsCustomStream = { key: string; name: string; icon: string; kinds: GcsStreamKind[]; forumIds: number[] };

export type GcsStreamsConfig = {
  /** Ce apare în fluxul „Tot” (și în filtrele lui). */
  kinds: GcsStreamKind[];
  /** Forumurile care nu apar deloc în activitate (ex. off-topic, arhivă). */
  excludeForumIds: number[];
  /** Elemente pe pagină. */
  perPage: number;
  /** Fluxurile proprii, ca tab-uri. */
  custom: GcsCustomStream[];
};

export const DEFAULT_STREAMS: GcsStreamsConfig = { kinds: ["topic", "reply", "status", "member"], excludeForumIds: [], perPage: 25, custom: [] };

const KEY = /^[a-z0-9-]{2,30}$/;
const kindsOk = (v: unknown): v is GcsStreamKind[] => Array.isArray(v) && v.length > 0 && v.every((k) => (GCS_STREAM_KINDS as readonly string[]).includes(k as string));
const idsOk = (v: unknown): v is number[] => Array.isArray(v) && v.length <= 500 && v.every((n) => Number.isInteger(n) && (n as number) > 0);

export function streamsConfigError(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "invalid";
  const c = v as Partial<GcsStreamsConfig>;
  if (!kindsOk(c.kinds) || !idsOk(c.excludeForumIds)) return "invalid";
  if (!Number.isInteger(c.perPage) || c.perPage! < 10 || c.perPage! > 50) return "invalid_range";
  if (!Array.isArray(c.custom) || c.custom.length > 12) return "too_many";
  const keys = new Set<string>();
  for (const s of c.custom) {
    if (!s || typeof s !== "object" || typeof s.key !== "string" || !KEY.test(s.key) || keys.has(s.key)) return "invalid";
    keys.add(s.key);
    if (typeof s.name !== "string" || s.name.trim().length < 2 || s.name.length > 40) return "invalid";
    if (typeof s.icon !== "string" || (s.icon !== "" && !isGcsIcon(s.icon))) return "invalid";
    if (!kindsOk(s.kinds) || !idsOk(s.forumIds)) return "invalid";
  }
  return null;
}

export const streamsSetting: GcsSettingDef = { key: STREAMS_SETTING, type: "json", default: DEFAULT_STREAMS, section: "streams", labelKey: "settings.streams.config", validate: streamsConfigError };

export async function loadStreamsConfig(settings: Pick<GcsSettingsService, "get">): Promise<GcsStreamsConfig> {
  const v = await settings.get<GcsStreamsConfig | null>(STREAMS_SETTING).catch(() => null);
  return v && streamsConfigError(v) === null ? v : DEFAULT_STREAMS;
}

/** Cheia unui flux nou, din nume (unică între cele existente). */
export function streamKey(name: string, taken: string[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "flux";
  let key = base.length >= 2 ? base : `flux-${base}`;
  for (let i = 2; taken.includes(key); i++) key = `${base}-${i}`;
  return key;
}
