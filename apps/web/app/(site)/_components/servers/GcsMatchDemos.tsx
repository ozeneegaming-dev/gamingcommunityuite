import type { GcsMatchDemos as GcsMatchDemosData } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

const STATUS_BADGE: Record<string, string> = {
  waiting: "gcs-badge--neutral",
  fetching: "gcs-badge--warn",
  available: "gcs-badge--ok",
  not_found: "gcs-badge--neutral",
  failed: "gcs-badge--accent",
  expired: "gcs-badge--neutral",
};

/** Mărimea unui fișier, în MB / KB, în limba paginii. */
export async function formatSize(bytes: number): Promise<string> {
  const format = await getFormatter();
  if (bytes >= 1024 * 1024) return `${format.number(bytes / 1024 / 1024, { maximumFractionDigits: 1 })} MB`;
  return `${format.number(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/**
 * Demo-ul unui meci mix (specul 2026-10-08-servere-hltv §1, §7): „Descarcă demo” cu mărimea, data și descărcările (cine
 * are dreptul), iar pentru staff starea fiecărui fișier (în așteptare / în transfer / disponibil / negăsit / expirat /
 * eroare + codul), cu legătura spre setările HLTV / GOTV ale serverului. Fără nimic de arătat, nu se randează.
 */
export async function GcsMatchDemos({ demos, serverId }: { demos: GcsMatchDemosData; serverId: number }) {
  if (demos.files.length === 0 && !demos.available && (demos.staff === null || demos.staff.length === 0)) return null;
  const [t, format] = await Promise.all([getTranslations("bridge.demos"), getFormatter()]);
  const sizes = await Promise.all(demos.files.map((f) => formatSize(f.size)));
  const parts = demos.files.length;
  return (
    <section className="gcs-card gcs-titledBox gcs-matchDemos" aria-labelledby="gcs-match-demos" data-testid="gcs-match-demos">
      <div className="gcs-titleBand">
        <h2 id="gcs-match-demos" className="gcs-display gcs-matchDemos__title">
          <GcsIcon name="fa-solid fa-film" className="gcs-hIcon" />
          {t("title")}
        </h2>
      </div>
      <div className="gcs-matchDemos__body">
        {parts > 0 && (
          <ul className="gcs-matchDemos__files">
            {demos.files.map((f, i) => (
              <li key={f.id} className="gcs-matchDemos__file" data-testid="gcs-demo-file">
                <a href={f.url} download={f.fileName} className="gcs-btn gcs-btn--primary" data-testid="gcs-demo-download">
                  <GcsIcon name="fa-solid fa-download" />
                  {parts > 1 ? t("downloadPart", { part: f.part }) : t("download")}
                </a>
                <span className="gcs-matchDemos__meta">
                  <span data-testid="gcs-demo-size">{sizes[i]}</span>
                  <span>{format.dateTime(new Date(f.availableAt), { dateStyle: "medium", timeStyle: "short" })}</span>
                  <span data-testid="gcs-demo-downloads">{t("downloads", { count: f.downloads })}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {parts > 0 && <p className="gcs-matchDemos__hint">{t("hint")}</p>}
        {parts === 0 && demos.available && !demos.canDownload && <p className="gcs-serverNote">{t("noRight")}</p>}
        {demos.staff !== null && demos.staff.length > 0 && (
          <div className="gcs-matchDemos__staff" data-testid="gcs-demo-staff">
            <h3 className="gcs-matchDemos__staffTitle">{t("staffTitle")}</h3>
            <ul className="gcs-matchDemos__states">
              {demos.staff.map((s) => (
                <li key={s.id} data-testid="gcs-demo-state" data-status={s.status}>
                  <span className="gcs-muted">{t("part", { part: s.part })}</span>
                  <span className={`gcs-badge ${STATUS_BADGE[s.status] ?? "gcs-badge--neutral"}`}>{t(`status.${s.status}`)}</span>
                  {s.error && <span className="gcs-muted">{t.has(`errors.${s.error}`) ? t(`errors.${s.error}`) : s.error}</span>}
                  {s.status === "waiting" && s.nextAttemptAt && (
                    <span className="gcs-muted">{t("nextAttempt", { at: format.dateTime(new Date(s.nextAttemptAt), { timeStyle: "short" }), attempts: s.attempts })}</span>
                  )}
                </li>
              ))}
            </ul>
            <Link href={`/admin/gaming/servers/${serverId}/bridge#gcs-bridge-tv`} className="gcs-matchDemos__acp">
              {t("settings")}
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
