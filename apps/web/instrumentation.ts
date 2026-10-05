/**
 * Rulează o singură dată, la pornirea serverului Next.js (spec §17, §17.1):
 * - neinstalat: generează codul de instalare și îl scrie în log (`docker compose logs web`);
 * - instalat: aplică migrațiile care lipsesc (cu lock, sigur și cu mai multe containere `web`).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureInstallCode, GcsInstallState } = await import("@gcs/core");
  const { migrateDatabase } = await import("@gcs/db/migrate");
  const { gcsConfigDir } = await import("./lib/config");
  const { migrationsDir } = await import("./lib/migrations");

  const configDir = gcsConfigDir();
  if (!(await new GcsInstallState(configDir).isInstalled())) {
    await ensureInstallCode(configDir).catch((error: unknown) => console.error("[RED-LINE] Codul de instalare nu a putut fi generat", error));
    return;
  }
  if (!process.env.DATABASE_URL) return;
  try {
    const { applied } = await migrateDatabase(process.env.DATABASE_URL, migrationsDir());
    if (applied.length > 0) console.log(`[RED-LINE] Migrații aplicate: ${applied.join(", ")}`);
  } catch (error) {
    console.error("[RED-LINE] Migrarea bazei de date a eșuat", error);
  }
}
