/** Datele de conexiune introduse în wizard-ul de instalare. */
export type GcsMysqlConnection = { host: string; port: number; user: string; password: string; database: string };

export type GcsMysqlProbe =
  | { ok: true; created: boolean; version: string }
  | { ok: false; errorKey: "db_unreachable" | "db_auth" | "db_no_create_privilege" | "db_no_privileges" | "db_mysql_version"; detail?: string };

const TIMEOUT_MS = 5000;

/** MySQL 8.0.13+ (valori implicite ca expresii, ferestre, JSON) sau MariaDB 10.6+. */
export function mysqlVersionSupported(version: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) return false;
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (/mariadb/i.test(version)) return major > 10 || (major === 10 && minor >= 6);
  return major > 8 || (major === 8 && (minor > 0 || patch >= 13));
}

function connectError(error: unknown): "db_unreachable" | "db_auth" {
  const code = (error as { code?: string }).code;
  return code === "ER_ACCESS_DENIED_ERROR" || code === "ER_DBACCESS_DENIED_ERROR" ? "db_auth" : "db_unreachable";
}

type Conn = { query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>; end(): Promise<void> };

/**
 * Pasul „Baza de date” pe MySQL / MariaDB (ediția Lite): conectarea la server, versiunea, crearea bazei dacă lipsește
 * (pe găzduirile partajate baza se creează de obicei din panou, iar utilizatorul nu are voie să creeze altele) și
 * dreptul de a crea tabele în ea. Întoarce cheia erorii (tradusă în wizard).
 */
export async function probeMysql(conn: GcsMysqlConnection): Promise<GcsMysqlProbe> {
  const mysql = (await import("mysql2/promise")) as unknown as { createConnection(o: Record<string, unknown>): Promise<Conn> };
  const base = { host: conn.host, port: conn.port, user: conn.user, password: conn.password, connectTimeout: TIMEOUT_MS };
  let server: Conn;
  try {
    server = await mysql.createConnection(base);
  } catch (error) {
    return { ok: false, errorKey: connectError(error) };
  }
  let created = false;
  let version = "";
  try {
    const [rows] = (await server.query("SELECT VERSION() AS v")) as [{ v: string }[], unknown];
    version = rows[0]?.v ?? "";
    if (!mysqlVersionSupported(version)) return { ok: false, errorKey: "db_mysql_version", detail: version };
    const [found] = (await server.query("SELECT SCHEMA_NAME AS s FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [conn.database])) as [unknown[], unknown];
    if (found.length === 0) {
      try {
        await server.query(`CREATE DATABASE \`${conn.database.replace(/`/g, "``")}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        created = true;
      } catch {
        return { ok: false, errorKey: "db_no_create_privilege" };
      }
    }
  } finally {
    await server.end().catch(() => {});
  }

  let target: Conn;
  try {
    target = await mysql.createConnection({ ...base, database: conn.database });
  } catch (error) {
    return { ok: false, errorKey: connectError(error) };
  }
  try {
    // Migrațiile creează tabele, indexuri și chei străine: o probă cu un tabel temporar (nu rămâne nimic în urmă).
    await target.query("CREATE TABLE IF NOT EXISTS gcs_install_probe (id INT PRIMARY KEY)");
    await target.query("DROP TABLE gcs_install_probe");
    return { ok: true, created, version };
  } catch {
    return { ok: false, errorKey: "db_no_privileges" };
  } finally {
    await target.end().catch(() => {});
  }
}
