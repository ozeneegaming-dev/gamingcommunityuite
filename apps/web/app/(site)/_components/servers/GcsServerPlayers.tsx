"use client";

import { useTranslations } from "next-intl";
import { serverState, useServerPlayers, useServerStatus } from "./GcsServerLive";

/**
 * Tabelul jucătorilor de pe pagina unui server (nume, scor, timp), reîmprospătat la intervalul de interogare. Numele
 * vin de la serverul de joc: sunt curățate pe server și se afișează doar ca text.
 */
export function GcsServerPlayers({ serverId, hidden, headingId }: { serverId: number; hidden: boolean; headingId: string }) {
  const t = useTranslations("servers");
  const status = useServerStatus(serverId);
  const players = useServerPlayers();
  const state = serverState(status);
  const duration = (seconds: number | null) => {
    if (seconds === null) return "—";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? t("duration.hours", { h, m }) : t("duration.minutes", { m });
  };
  const count = status?.online ? status.players : 0;
  const sampleOnly = players?.some((p) => p.score === null && p.time === null) ?? false;

  return (
    <>
      <h2 id={headingId} className="gcs-display gcs-titleBand gcs-serverBox__title">
        {t("playersCount", { count })}
      </h2>
      {hidden ? (
        <p className="gcs-serverNote">{t("playersHidden")}</p>
      ) : state !== "online" ? (
        <p className="gcs-serverNote">{state === "offline" ? t("playersOffline") : t("unknownStatus")}</p>
      ) : !players ? (
        <p className="gcs-serverNote">{t("playersUnavailable")}</p>
      ) : players.length === 0 ? (
        <p className="gcs-serverNote">{t("playersNone")}</p>
      ) : (
        <>
          {/* Lista lungă derulează în casetă (antetul tabelului rămâne sus); zona primește focus din tastatură. */}
          <div className="gcs-serverPlayersScroll" tabIndex={0} role="region" aria-labelledby={headingId}>
            <table className="gcs-serverPlayers" aria-labelledby={headingId} data-testid="gcs-server-players-table">
              <thead>
                <tr>
                  <th scope="col">{t("player")}</th>
                  {!sampleOnly && <th scope="col">{t("score")}</th>}
                  {!sampleOnly && <th scope="col">{t("time")}</th>}
                </tr>
              </thead>
              <tbody>
                {players.map((p, i) => (
                  <tr key={`${i}-${p.name}`}>
                    <td>{p.name}</td>
                    {!sampleOnly && <td>{p.score ?? "—"}</td>}
                    {!sampleOnly && <td>{duration(p.time)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sampleOnly && <p className="gcs-serverNote">{t("playersSample")}</p>}
        </>
      )}
    </>
  );
}
