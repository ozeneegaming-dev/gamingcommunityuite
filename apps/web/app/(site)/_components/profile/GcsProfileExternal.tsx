import type { GcsExternalEntry, GcsFaceitView, GcsSteamView } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import { getFormatter, getTranslations } from "next-intl/server";
import { GcsShowMore } from "./GcsShowMore";

/** Anii întregi dintre o dată și acum (vechimea contului Steam). */
function yearsSince(iso: string): number {
  const d = new Date(iso);
  const now = new Date();
  let years = now.getUTCFullYear() - d.getUTCFullYear();
  if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) years--;
  return Math.max(0, years);
}

/** Antetul comun al tabelor externe: titlul, linkul spre contul extern și ora ultimei citiri (cu eroarea, dacă e). */
async function Updated({ entry }: { entry: { fetchedAt: string; error: string | null } }) {
  const [t, format] = await Promise.all([getTranslations("profile.external"), getFormatter()]);
  return (
    <p className="gcs-muted gcs-external__updated" data-testid="gcs-external-updated">
      <GcsIcon name="fa-solid fa-rotate" className="gcs-hIcon" />
      {t("updated", { time: format.relativeTime(new Date(entry.fetchedAt)) })}
      {entry.error && ` · ${t(`errors.${["no_key", "unauthorized", "rate_limited"].includes(entry.error) ? entry.error : "other"}`)}`}
    </p>
  );
}

/** Tabul Steam (profil gaming v2 §2): statusul, nivelul, cele 3 forme ale SteamID-ului, vechimea, banurile și jocurile. */
export async function GcsSteamTab({ entry, pending }: { entry: GcsExternalEntry<GcsSteamView> | null; pending: boolean }) {
  const [t, format] = await Promise.all([getTranslations("profile.steam"), getFormatter()]);
  if (!entry) {
    return (
      <GcsCard as="section" className="gcs-titledBox" data-testid="gcs-profile-steam">
        <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
          <GcsIcon name="fa-brands fa-steam" className="gcs-hIcon" />
          {t("title")}
        </h2>
        <p className="gcs-muted" style={{ margin: 0 }}>
          <GcsIcon name="fa-regular fa-clock" className="gcs-emptyIcon" />
          {pending ? t("pending") : t("empty")}
        </p>
      </GcsCard>
    );
  }
  const s = entry.data;
  const hours = (h: number) => t("hours", { hours: format.number(h, { maximumFractionDigits: 1 }) });
  const banned = s.bans.vac > 0 || s.bans.game > 0 || s.bans.community || s.bans.economy;
  return (
    <GcsCard as="section" className="gcs-titledBox gcs-external" data-testid="gcs-profile-steam">
      <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
        <GcsIcon name="fa-brands fa-steam" className="gcs-hIcon" />
        {t("title")}
        <a href={s.profileUrl} rel="nofollow noopener" target="_blank" className="gcs-titleBand__link">
          {t("open")}
          <GcsIcon name="fa-solid fa-arrow-up-right-from-square" />
        </a>
      </h2>
      <div className="gcs-external__head">
        <span className="gcs-external__status" data-status={s.inGame ? "play" : s.status} data-testid="gcs-steam-status">
          <span className="gcs-dot" aria-hidden="true" />
          {s.inGame ? t("inGame", { game: s.inGame }) : t(`status.${s.status}`)}
        </span>
        {s.level !== null && (
          <span className="gcs-external__level" data-testid="gcs-steam-level">
            {t("level", { level: s.level })}
          </span>
        )}
        {s.name && <strong className="gcs-external__name">{s.name}</strong>}
      </div>
      <dl className="gcs-external__grid">
        <div>
          <dt>SteamID64</dt>
          <dd className="gcs-mono" data-testid="gcs-steam-id64">{s.steamId64}</dd>
        </div>
        <div>
          <dt>SteamID</dt>
          <dd className="gcs-mono">{s.steamId}</dd>
        </div>
        <div>
          <dt>SteamID3</dt>
          <dd className="gcs-mono">{s.steamId3}</dd>
        </div>
        <div>
          <dt>{t("age")}</dt>
          <dd>{s.createdAt ? t("years", { count: yearsSince(s.createdAt) }) : "—"}</dd>
        </div>
        <div>
          <dt>{t("lastOnline")}</dt>
          <dd>{s.status !== "offline" ? t("now") : s.lastOnlineAt ? format.relativeTime(new Date(s.lastOnlineAt)) : "—"}</dd>
        </div>
      </dl>
      <div className="gcs-external__bans" aria-label={t("bans.title")} data-testid="gcs-steam-bans">
        <span className="gcs-statusChip" data-state={s.bans.vac > 0 ? "bad" : "ok"}>
          {s.bans.vac > 0 ? t("bans.vac", { count: s.bans.vac }) : t("bans.noVac")}
        </span>
        <span className="gcs-statusChip" data-state={s.bans.game > 0 ? "bad" : "ok"}>
          {s.bans.game > 0 ? t("bans.game", { count: s.bans.game }) : t("bans.noGame")}
        </span>
        <span className="gcs-statusChip" data-state={s.bans.community ? "bad" : "ok"}>
          {s.bans.community ? t("bans.community") : t("bans.noCommunity")}
        </span>
        {banned && s.bans.daysSinceLast !== null && <span className="gcs-muted">{t("bans.since", { days: s.bans.daysSinceLast })}</span>}
      </div>
      {!s.public ? (
        <p className="gcs-notice">{t("private")}</p>
      ) : (
        <>
          <dl className="gcs-external__totals">
            <div>
              <dt>{t("games")}</dt>
              <dd className="gcs-display">{s.games.count === null ? "—" : format.number(s.games.count)}</dd>
            </div>
            <div>
              <dt>{t("totalHours")}</dt>
              <dd className="gcs-display">{hours(s.games.totalHours)}</dd>
            </div>
            <div>
              <dt>{t("twoWeeks")}</dt>
              <dd className="gcs-display">{hours(s.games.twoWeekHours)}</dd>
            </div>
          </dl>
          {s.games.recent.length > 0 && (
            <>
              <h3 className="gcs-external__sub">{t("recent")}</h3>
              <ul className="gcs-external__games" data-testid="gcs-steam-recent">
                {s.games.recent.map((g) => (
                  <li key={g.appId}>
                    <span>{g.name}</span>
                    <span className="gcs-muted">{t("recentHours", { recent: format.number(g.twoWeekHours, { maximumFractionDigits: 1 }), total: format.number(g.hours, { maximumFractionDigits: 1 }) })}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {s.games.top.length > 0 && (
            <>
              <h3 className="gcs-external__sub">{t("byHours")}</h3>
              <GcsShowMore initial={8} labels={{ more: t("more"), less: t("less") }} className="gcs-external__games" testId="gcs-steam-games">
                {s.games.top.map((g) => (
                  <li key={g.appId}>
                    <span>{g.name}</span>
                    <span className="gcs-muted">{hours(g.hours)}</span>
                  </li>
                ))}
              </GcsShowMore>
            </>
          )}
        </>
      )}
      <Updated entry={entry} />
    </GcsCard>
  );
}

/** Graficul istoricului ELO (SVG simplu, pe culoarea accentului; scara între minimul și maximul seriei). */
function EloChart({ points, label }: { points: { at: string; elo: number }[]; label: string }) {
  if (points.length < 2) return null;
  const w = 600;
  const h = 140;
  const pad = 10;
  const min = Math.min(...points.map((p) => p.elo));
  const max = Math.max(...points.map((p) => p.elo));
  const span = Math.max(1, max - min);
  const xy = points.map((p, i) => [pad + (i / (points.length - 1)) * (w - 2 * pad), h - pad - ((p.elo - min) / span) * (h - 2 * pad)] as const);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <figure className="gcs-eloChart" data-testid="gcs-faceit-chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} preserveAspectRatio="none">
        <polygon points={`${pad},${h - pad} ${line} ${w - pad},${h - pad}`} className="gcs-eloChart__area" />
        <polyline points={line} className="gcs-eloChart__line" fill="none" />
        {xy.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={3} className="gcs-eloChart__dot">
            <title>{`${new Date(points[i]!.at).toLocaleDateString()} · ${points[i]!.elo}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="gcs-muted">
        {min} – {max}
      </figcaption>
    </figure>
  );
}

/** Tabul FACEIT CS2: nivelul, ELO-ul, locul în comunitate, ultimele 5 rezultate, statisticile, graficul și meciurile. */
export async function GcsFaceitTab({ entry }: { entry: GcsExternalEntry<GcsFaceitView> & { ranking: { position: number; total: number } | null } }) {
  const [t, format] = await Promise.all([getTranslations("profile.faceit"), getFormatter()]);
  const f = entry.data;
  const pct = (v: number | null) => (v === null ? "—" : `${format.number(v, { maximumFractionDigits: 1 })}%`);
  const dec = (v: number | null) => (v === null ? "—" : format.number(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  return (
    <GcsCard as="section" className="gcs-titledBox gcs-external" data-testid="gcs-profile-faceit">
      <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
        <GcsIcon name="fa-solid fa-trophy" className="gcs-hIcon" />
        {t("title")}
        <a href={f.url} rel="nofollow noopener" target="_blank" className="gcs-titleBand__link">
          {f.nickname || t("open")}
          <GcsIcon name="fa-solid fa-arrow-up-right-from-square" />
        </a>
      </h2>
      <div className="gcs-external__head">
        {f.level !== null && (
          <span className="gcs-faceitLevel" data-level={f.level} data-testid="gcs-faceit-level" aria-label={t("level", { level: f.level })}>
            {f.level}
          </span>
        )}
        <div className="gcs-external__elo">
          <strong className="gcs-display" data-testid="gcs-faceit-elo">
            {f.elo === null ? "—" : format.number(f.elo, { useGrouping: false })}
          </strong>
          <span className="gcs-muted">ELO</span>
        </div>
        {entry.ranking && (
          <span className="gcs-external__level" data-testid="gcs-faceit-ranking">
            {t("ranking", { position: entry.ranking.position, total: entry.ranking.total })}
          </span>
        )}
        {f.stats.recent.length > 0 && (
          <ol className="gcs-faceitRecent" aria-label={t("recent")} data-testid="gcs-faceit-recent">
            {f.stats.recent.map((r, i) => (
              <li key={i} data-result={r} title={r === "W" ? t("win") : t("loss")}>
                {r === "W" ? t("w") : t("l")}
              </li>
            ))}
          </ol>
        )}
      </div>
      <dl className="gcs-external__grid gcs-external__grid--stats" data-testid="gcs-faceit-stats">
        {(
          [
            [t("matches"), format.number(f.stats.matches)],
            [t("winRate"), pct(f.stats.winRate)],
            [t("kd"), dec(f.stats.kd)],
            [t("hs"), pct(f.stats.hs)],
            [t("adr"), f.stats.adr === null ? "—" : format.number(f.stats.adr, { maximumFractionDigits: 1 })],
            [t("longestStreak"), f.stats.longestStreak === null ? "—" : format.number(f.stats.longestStreak)],
            [t("currentStreak"), f.stats.currentStreak === null ? "—" : format.number(f.stats.currentStreak)],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="gcs-display">{value}</dd>
          </div>
        ))}
      </dl>
      {f.history.length >= 2 && (
        <>
          <h3 className="gcs-external__sub">{t("history")}</h3>
          <EloChart points={f.history} label={t("history")} />
        </>
      )}
      {f.matches.length > 0 && (
        <>
          <h3 className="gcs-external__sub">{t("matchesTitle")}</h3>
          <ul className="gcs-external__games" data-testid="gcs-faceit-matches">
            {f.matches.map((m) => (
              <li key={m.id}>
                <span className="gcs-statusChip" data-state={m.result === "W" ? "ok" : "bad"}>
                  {m.result === "W" ? t("win") : t("loss")}
                </span>
                <span>{m.score}</span>
                <span className="gcs-muted">{format.relativeTime(new Date(m.at))}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Updated entry={entry} />
    </GcsCard>
  );
}
