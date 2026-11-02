/**
 * Rulează o singură dată, la pornirea serverului Next.js (spec §17, §17.1):
 * - neinstalat: generează codul de instalare și îl scrie pe stderr (`docker compose logs web`; în Lite, `stderr.log`);
 * - instalat: aplică migrațiile care lipsesc (cu lock, sigur și cu mai multe containere `web`), apoi seed-ul modulelor.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureInstallCode, GcsInstallState } = await import("@gcs/core");
  const { migrateDatabase } = await import("@gcs/db/migrate");
  const { gcsConfigDir } = await import("./lib/config");
  const { migrationsDir } = await import("./lib/migrations");

  const configDir = gcsConfigDir();
  if (!(await new GcsInstallState(configDir).isInstalled())) {
    await ensureInstallCode(configDir).catch((error: unknown) => console.error("[GCS] Codul de instalare nu a putut fi generat", error));
    return;
  }
  if (!process.env.DATABASE_URL) return;
  try {
    const { applied } = await migrateDatabase(process.env.DATABASE_URL, migrationsDir());
    if (applied.length > 0) console.log(`[GCS] Migrații aplicate: ${applied.join(", ")}`);
  } catch (error) {
    console.error("[GCS] Migrarea bazei de date a eșuat", error);
    return;
  }
  // Datele implicite ale modulelor (ex. reacțiile și setările de grup ale forumului) pentru site-urile instalate
  // înaintea modulului. Seed-ul e idempotent și nu suprascrie ce s-a schimbat din ACP.
  try {
    const { seedDefaults } = await import("@gcs/core");
    const { services } = await import("./lib/services");
    const { db, registry, cache } = services();
    await seedDefaults(db, registry);
    // Seed-ul poate actualiza meniul (ex. marcajul `nav:v2`), temele (marcajul `theme:nova`) și aplicațiile (o aplicație
    // nouă, ex. Chat Pro, pornește oprită): cache-ul lor din Redis supraviețuiește repornirii.
    await cache.invalidateTags(["nav", "themes", "apps"]);
  } catch (error) {
    console.error("[GCS] Seed-ul modulelor a eșuat", error);
  }
}
