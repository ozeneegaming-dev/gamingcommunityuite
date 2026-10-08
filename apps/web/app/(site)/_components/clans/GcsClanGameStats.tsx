import { kdRatio, type GcsClanDetails } from "@gcs/modules";
import { GcsUserLink } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { memberHref } from "@/lib/forum-urls";

/**
 * „Statistici de joc” pe pagina clanului (specul 2026-10-08-clanuri §15): totalurile membrilor de pe serverele
 * comunității (citite din aplicația Servere, doar când e activă) și membrii cei mai activi. Fără statistici, valorile sunt
 * „—”; un membru fără Steam conectat primește indicația să-l conecteze.
 */
export async function GcsClanGameStats({ clan }: { clan: GcsClanDetails }) {
  const [t, format] = await Promise.all([getTranslations("clans.game"), getFormatter()]);
  const game = clan.game!;
  const s = game.totals;
  const dash = "—";
  const hours = (seconds: number) => t("hours", { hours: format.number(Math.round(seconds / 3600)) });
  const facts: [string, string][] = [
    [t("playtime"), s ? hours(s.playtimeSeconds) : dash],
    [t("kd"), s ? format.number(s.kd, { maximumFractionDigits: 2 }) : dash],
    [t("headshots"), s?.headshotRate != null ? format.number(s.headshotRate, { style: "percent", maximumFractionDigits: 0 }) : dash],
    [t("mix"), s && s.mixPlayed > 0 ? t("mixValue", { won: s.mixWon, played: s.mixPlayed }) : dash],
    [t("elo"), s?.elo != null ? format.number(Math.round(s.elo)) : dash],
    [t("mvps"), s ? format.number(s.mvps) : dash],
  ];
  return (
    <section className="gcs-card gcs-titledBox" aria-labelledby="gcs-clan-game" data-testid="gcs-clan-game">
      <h2 id="gcs-clan-game" className="gcs-titleBand gcs-clanBox__title">
        <GcsIcon name="fa-solid fa-crosshairs" className="gcs-hIcon" />
        {t("title")}
        {s && <span className="gcs-clanBox__count">{t("players", { count: s.players })}</span>}
      </h2>
      <dl className="gcs-clanStats gcs-clanStats--game">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {s === null && <p className="gcs-muted" style={{ margin: "12px 0 0" }}>{t("empty")}</p>}
      {game.members.length > 0 && (
        <ul className="gcs-clanTopics" style={{ marginTop: 14 }} aria-label={t("top")}>
          {game.members.map((m) => (
            <li key={m.user.id}>
              <GcsUserLink userId={m.user.id} name={m.user.name} nameKey={m.user.nameKey} href={memberHref(m.user)} />
              <span className="gcs-muted">{t("memberLine", { hours: hours(m.stats.playtimeSeconds), kd: format.number(kdRatio(m.stats), { maximumFractionDigits: 2 }) })}</span>
            </li>
          ))}
        </ul>
      )}
      {clan.viewer.steamLinked === false && (
        <p className="gcs-field__hint" style={{ margin: "12px 0 0" }} data-testid="gcs-clan-steam-hint">
          {t("steamHint")} <Link href="/settings/account">{t("steamLink")}</Link>
        </p>
      )}
    </section>
  );
}
