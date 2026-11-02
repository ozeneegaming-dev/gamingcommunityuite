import {
  extensionListError,
  GCS_DEFAULT_ALLOWED_EXTENSIONS,
  GCS_IMAGE_DEFAULTS,
  GCS_REMOTE_IMAGE_MODES,
  parseExtensionList,
  type GcsRemoteImageMode,
  type GcsSettingDef,
  type GcsSettingsService,
  type GcsUploadPolicy,
} from "@gcs/core";

/**
 * ACP → Setări → Încărcări și imagini (`/admin/settings/uploads`): extensiile permise ale atașamentelor, imaginile
 * (latura maximă, calitatea, WebP, metadatele, miniaturile), imaginile externe din conținut și curățarea fișierelor
 * orfane. Limita de mărime rămâne setarea de grup `upload.max_mb` (ACP → Grupuri), arătată pe pagină.
 */
export const UPLOADS_SECTION = "uploads";

export const UPLOAD_SETTINGS = {
  allowedExtensions: "uploads.allowed_extensions",
  imageMaxSide: "uploads.image_max_side",
  imageQuality: "uploads.image_quality",
  convertWebp: "uploads.convert_webp",
  stripMetadata: "uploads.strip_metadata",
  thumbnailSide: "uploads.thumbnail_side",
  remoteImages: "uploads.remote_images",
  orphanDays: "uploads.orphan_days",
} as const;

const intIn = (min: number, max: number) => (v: unknown) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : "invalid_range");
const oneOf = (values: readonly string[]) => (v: unknown) => (values.includes(v as string) ? null : "invalid_choice");
/** Latura miniaturii: 0 (fără miniaturi) sau 64–1200 px. */
const thumbSideError = (v: unknown) => (v === 0 ? null : intIn(64, 1200)(v));

const def = (key: string, type: GcsSettingDef["type"], defaultValue: unknown, validate?: GcsSettingDef["validate"], extra: Partial<GcsSettingDef> = {}): GcsSettingDef => ({
  key,
  type,
  default: defaultValue,
  section: UPLOADS_SECTION,
  labelKey: `settings.${key}`,
  ...(validate ? { validate } : {}),
  ...extra,
});

export const UPLOAD_SETTING_DEFS: GcsSettingDef[] = [
  def(UPLOAD_SETTINGS.allowedExtensions, "string", GCS_DEFAULT_ALLOWED_EXTENSIONS, extensionListError, { multiline: true }),
  def(UPLOAD_SETTINGS.imageMaxSide, "number", GCS_IMAGE_DEFAULTS.maxSide, intIn(320, 10_000)),
  def(UPLOAD_SETTINGS.imageQuality, "number", GCS_IMAGE_DEFAULTS.quality, intIn(30, 100)),
  def(UPLOAD_SETTINGS.convertWebp, "boolean", GCS_IMAGE_DEFAULTS.webp),
  def(UPLOAD_SETTINGS.stripMetadata, "boolean", GCS_IMAGE_DEFAULTS.stripMetadata),
  def(UPLOAD_SETTINGS.thumbnailSide, "number", GCS_IMAGE_DEFAULTS.thumbnailSide, thumbSideError),
  def(UPLOAD_SETTINGS.remoteImages, "string", "allow", oneOf(GCS_REMOTE_IMAGE_MODES), { options: [...GCS_REMOTE_IMAGE_MODES] }),
  // 0 = oprită; altfel jobul zilnic `uploads.orphans` șterge fișierele încărcate și nelegate de nimic de atâtea zile.
  def(UPLOAD_SETTINGS.orphanDays, "number", 0, intIn(0, 3650)),
];

type Settings = Pick<GcsSettingsService, "get">;
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Setările citite de pipeline-ul atașamentelor la fiecare upload (din cache-ul setărilor). */
export async function loadUploadPolicy(settings: Settings): Promise<GcsUploadPolicy> {
  const [exts, maxSide, quality, webp, strip, thumb] = await Promise.all([
    settings.get<string>(UPLOAD_SETTINGS.allowedExtensions),
    settings.get<number>(UPLOAD_SETTINGS.imageMaxSide),
    settings.get<number>(UPLOAD_SETTINGS.imageQuality),
    settings.get<boolean>(UPLOAD_SETTINGS.convertWebp),
    settings.get<boolean>(UPLOAD_SETTINGS.stripMetadata),
    settings.get<number>(UPLOAD_SETTINGS.thumbnailSide),
  ]);
  return {
    allowedExtensions: parseExtensionList(typeof exts === "string" ? exts : GCS_DEFAULT_ALLOWED_EXTENSIONS),
    image: {
      maxSide: num(maxSide, GCS_IMAGE_DEFAULTS.maxSide),
      quality: num(quality, GCS_IMAGE_DEFAULTS.quality),
      webp: webp !== false,
      stripMetadata: strip !== false,
      thumbnailSide: num(thumb, GCS_IMAGE_DEFAULTS.thumbnailSide),
    },
  };
}

/** Politica imaginilor externe din conținut (`allow` dacă setarea lipsește sau e stricată). */
export async function loadRemoteImageMode(settings: Settings): Promise<GcsRemoteImageMode> {
  const v = await settings.get<string>(UPLOAD_SETTINGS.remoteImages).catch(() => "allow");
  return (GCS_REMOTE_IMAGE_MODES as readonly string[]).includes(v) ? (v as GcsRemoteImageMode) : "allow";
}
