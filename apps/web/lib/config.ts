import path from "node:path";

/**
 * Folderul de configurare (volumul `gcsconfig`, montat în container la `/app/config`): starea instalării,
 * `.env.runtime` cu secretele și lock-urile. Local, implicit `apps/web/.gcs-config`.
 */
export function gcsConfigDir(): string {
  return process.env.GCS_CONFIG_DIR ?? path.resolve(process.cwd(), ".gcs-config");
}
