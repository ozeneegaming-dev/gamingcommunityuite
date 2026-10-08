import type { GcsMatchSummary } from "@gcs/modules";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { matchResult } from "./GcsBridgeBits";
import { matchHref } from "./types";

/**
 * Lista meciurilor mix (istoricul, profilul jucătorului, pagina serverului): echipele cu scorul, harta, serverul, data și
 * starea; din perspectiva unui jucător (`perspective`), rezultatul lui, ucideri–decese și schimbarea de ELO.
 */
export async function GcsMatchRows({ matches, perspective = false, showServer = true }: { matches: GcsMatchSummary[]; perspective?: boolean; showServer?: boolean }) {
  const [t, tr, format] = await Promise.all([getTranslations("bridge.matches"), getTranslations("bridge.result"), getFormatter()]);
  return (
    <ul className="gcs-matchRows" data-testid="gcs-match-rows">
      {matches.map((m) => {
        const mine = perspective ? m.player : undefined;
        const result = mine ? matchResult(mine.team, m.winner) : null;
        const delta = mine && mine.eloBefore !== null && mine.eloAfter !== null ? mine.eloAfter - mine.eloBefore : null;
        return (
          <li key={m.id} className="gcs-matchRow" data-status={m.status} {...(result ? { "data-result": result } : {})} data-testid="gcs-match-row">
            {result ? (
              <span className="gcs-matchRow__result" data-result={result}>
                {result === "open" ? t(`status.${m.status}`) : tr(result)}
              </span>
            ) : (
              <span className="gcs-matchRow__result" data-status={m.status}>
                {t(`status.${m.status}`)}
              </span>
            )}
            <Link href={matchHref(m.id)} className="gcs-matchRow__teams">
              <span className="gcs-matchRow__team" data-team="A" data-won={m.winner === "A" ? "" : undefined}>
                {m.teams.A.name}
              </span>
              <span className="gcs-display gcs-matchRow__score">
                <span data-team="A">{m.teams.A.score}</span>
                <span aria-hidden="true">:</span>
                <span className="gcs-srOnly">{t("scoreSep")}</span>
                <span data-team="B">{m.teams.B.score}</span>
              </span>
              <span className="gcs-matchRow__team" data-team="B" data-won={m.winner === "B" ? "" : undefined}>
                {m.teams.B.name}
              </span>
            </Link>
            <span className="gcs-matchRow__meta">
              {m.map && <span>{m.map}</span>}
              {showServer && <span>{m.server.name}</span>}
              <time dateTime={m.startedAt}>{format.dateTime(new Date(m.endedAt ?? m.startedAt), { dateStyle: "medium", timeStyle: "short" })}</time>
            </span>
            {mine && (
              <span className="gcs-matchRow__mine">
                <span className="gcs-matchRow__kd">{t("kd", { kills: mine.kills, deaths: mine.deaths })}</span>
                {delta !== null && (
                  <span className="gcs-eloDelta" data-sign={delta > 0 ? "up" : delta < 0 ? "down" : "flat"}>
                    {t("eloDelta", { delta: delta > 0 ? `+${delta}` : String(delta) })}
                  </span>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
