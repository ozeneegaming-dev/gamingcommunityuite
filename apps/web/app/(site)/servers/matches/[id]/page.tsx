import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsMatchBoard, type GcsBoardState } from "../../../_components/servers/GcsMatchBoard";

type Props = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

const load = cache(async (raw: string) => {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  const { serverQueries, bridge } = services();
  if (!(await serverQueries.appEnabled())) return null;
  return bridge.queries.match(await currentActor(), Number(raw));
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const m = await load((await params).id);
  if (!m) return {};
  return { title: `${m.teams.A.name} ${m.teams.A.score}–${m.teams.B.score} ${m.teams.B.name}` };
}

/**
 * Pagina unui meci mix (specul 2026-10-08-servere-pagini §7): tabela de scor peste imaginea hărții, banda rundelor,
 * echipele cu jucătorii (ucideri, decese, asistențe, headshot-uri, damage pe rundă, MVP, ELO). Un meci deschis se
 * actualizează live (camera `match:{id}`).
 */
export default async function MatchPage({ params }: Props) {
  const match = await load((await params).id);
  if (!match) notFound();
  const t = await getTranslations("bridge.matches");
  const state: GcsBoardState = {
    id: match.id,
    status: match.status,
    map: match.map || null,
    round: match.round,
    teams: match.teams,
    winner: match.winner,
    players: match.players,
    rounds: match.rounds.map((r) => ({ number: r.number, winner: r.winner })),
    startedAt: match.startedAt,
  };
  const serverHref = `/servers/${match.server.id}-${match.server.slug}`;
  const game = match.server.game;
  return (
    <>
      <header className="gcs-pageHeader">
        <nav aria-label={t("title")} className="gcs-breadcrumb">
          <ol>
            <li>
              <Link href="/servers">
                <GcsIcon name="fa-solid fa-server" className="gcs-breadcrumb__home" />
                {t("servers")}
              </Link>
            </li>
            <li>
              <Link href="/servers/matches">{t("title")}</Link>
            </li>
            <li aria-current="page">#{match.id}</li>
          </ol>
        </nav>
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title" data-testid="gcs-match-title">
            <GcsIcon name="fa-solid fa-crosshairs" className="gcs-hIcon" />
            {t("matchTitle", { a: match.teams.A.name, b: match.teams.B.name })}
          </h1>
          {!match.rated && match.status === "ended" && <p className="gcs-pageHeader__desc">{t("notRated")}</p>}
        </div>
      </header>
      <GcsMatchBoard initial={state} game={game} server={{ id: match.server.id, name: match.server.name, href: serverHref }} mode="match" />
    </>
  );
}
