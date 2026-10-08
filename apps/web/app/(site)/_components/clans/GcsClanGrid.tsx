import type { GcsClanCard } from "@gcs/modules";
import { GcsClanTag } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { clanColors, GcsClanLogo } from "./GcsClanLogo";

/** Recrutarea unui clan: intrare liberă, cu cerere sau doar cu invitație (textul, nu doar culoarea). */
export async function GcsClanRecruit({ mode }: { mode: GcsClanCard["joinMode"] }) {
  const t = await getTranslations("clans.recruit");
  const icon = mode === "OPEN" ? "fa-solid fa-door-open" : mode === "REQUEST" ? "fa-solid fa-envelope-open-text" : "fa-solid fa-lock";
  return (
    <span className="gcs-clanRecruit" data-mode={mode}>
      <GcsIcon name={icon} />
      {t(mode)}
    </span>
  );
}

/** Starea unui clan care nu e simplu activ: în așteptare, blocat, arhivat. */
export async function GcsClanStateLabel({ clan }: { clan: Pick<GcsClanCard, "status" | "locked"> }) {
  const t = await getTranslations("clans.state");
  const state = clan.status === "PENDING" ? "pending" : clan.locked ? "locked" : clan.status === "ARCHIVED" ? "archived" : null;
  if (!state) return null;
  const icon = state === "pending" ? "fa-solid fa-hourglass-half" : state === "locked" ? "fa-solid fa-lock" : "fa-solid fa-box-archive";
  return (
    <span className="gcs-clanState" data-state={state} data-testid="gcs-clan-state">
      <GcsIcon name={icon} />
      {t(state)}
    </span>
  );
}

/**
 * Grila directorului (specul 2026-10-08-clanuri §7.1): bannerul (imaginea sau degradeul culorilor) cu logo-ul și, la
 * sortarea pe clasament, locul; banda cu plăcuța și numele; membrii, punctele și recrutarea.
 */
export async function GcsClanGrid({ clans, showRank }: { clans: GcsClanCard[]; showRank: boolean }) {
  const [t, format] = await Promise.all([getTranslations("clans"), getFormatter()]);
  return (
    <ul className="gcs-clanGrid" data-testid="gcs-clan-grid">
      {clans.map((clan) => {
        const headingId = `gcs-clan-${clan.id}`;
        return (
          <li key={clan.id}>
            <article className="gcs-card gcs-clanCard" aria-labelledby={headingId} data-testid="gcs-clan-card" data-clan={clan.id}>
              <div className="gcs-clanBanner" style={clanColors(clan)}>
                {clan.bannerUrl && <img className="gcs-clanBanner__img" src={clan.bannerUrl} alt="" loading="lazy" decoding="async" />}
                {showRank && clan.rank !== null && (
                  <span className="gcs-clanCard__rank" aria-label={t("rankLabel", { rank: clan.rank })}>
                    #{clan.rank}
                  </span>
                )}
                <GcsClanLogo clan={clan} />
              </div>
              <header className="gcs-clanCard__head">
                <GcsClanTag clan={clan} size="sm" plain />
                <h2 id={headingId} className="gcs-display gcs-clanCard__name">
                  <Link href={clan.href}>{clan.name}</Link>
                </h2>
              </header>
              <div className="gcs-clanCard__body">
                <dl className="gcs-clanFacts">
                  <div>
                    <dt>{t("facts.members")}</dt>
                    <dd data-testid="gcs-clan-members">{format.number(clan.membersCount)}</dd>
                  </div>
                  <div>
                    <dt>{t("facts.score")}</dt>
                    <dd>{format.number(clan.score)}</dd>
                  </div>
                </dl>
                {clan.status === "ACTIVE" && !clan.locked ? <GcsClanRecruit mode={clan.joinMode} /> : <GcsClanStateLabel clan={clan} />}
                <div className="gcs-clanCard__foot">
                  <Link className="gcs-btn gcs-btn--ghost" href={clan.href} aria-label={t("viewClan", { name: clan.name })}>
                    {t("view")}
                  </Link>
                </div>
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
