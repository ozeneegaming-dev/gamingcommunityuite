import { GCS_GAME_FAMILIES, gameFamily, POLL_INTERVAL_SETTING, SERVERS_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { cardsData, initialStatuses } from "@/lib/servers";
import { services } from "@/lib/services";
import { GcsServerGrid, GcsServerSummary } from "../_components/servers/GcsServerGrid";
import { GcsServerLiveProvider } from "../_components/servers/GcsServerLive";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("servers"))("title") };
}

export const dynamic = "force-dynamic";

/**
 * `/servers` (specul 2026-10-07-servere §5.1): serverele vizibile viewer-ului, ca o grilă de carduri (macheta
 * aprobată), cu filtrul pe joc (`?game=`) și sumarul jucătorilor online, actualizate live.
 */
export default async function ServersPage({ searchParams }: { searchParams: Promise<{ game?: string }> }) {
  const { serverQueries, settings, acp } = services();
  if (!(await serverQueries.appEnabled())) notFound();
  const [sp, actor, t] = await Promise.all([searchParams, currentActor(), getTranslations("servers")]);
  const [all, interval] = await Promise.all([serverQueries.list(actor), settings.get<number>(POLL_INTERVAL_SETTING)]);
  const family = gameFamily(sp.game);
  const shown = family ? all.filter((s) => s.game.family === family.key) : all;
  // Filtrele: doar jocurile care au servere (cu un singur joc, filtrul nu are rost).
  const families = GCS_GAME_FAMILIES.filter((f) => all.some((s) => s.game.family === f.key));
  const canAdd = all.length === 0 && actor.userId !== null && (await acp.can(actor, SERVERS_ACP_SECTION, "edit"));
  const chip = (key: string | null, text: string) => {
    const active = (family?.key ?? null) === key;
    return (
      <Link key={key ?? "all"} href={key ? `/servers?game=${key}` : "/servers"} className={`gcs-segLink${active ? " gcs-segLink--active" : ""}`} aria-current={active ? "page" : undefined}>
        {text}
      </Link>
    );
  };

  return (
    <GcsServerLiveProvider initial={initialStatuses(shown)} pollSeconds={interval}>
      <header className="gcs-pageHeader">
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-server" className="gcs-hIcon" />
            {t("title")}
          </h1>
          <p className="gcs-pageHeader__desc gcs-serverLead">
            {shown.length > 0 ? <GcsServerSummary ids={shown.map((s) => s.id)} /> : <span>{t("leadEmpty")}</span>}
            <span>{t("refresh", { seconds: interval })}</span>
          </p>
        </div>
        {families.length > 1 && (
          <nav className="gcs-segLinks" aria-label={t("filterLabel")} data-testid="gcs-servers-filter">
            {chip(null, t("all"))}
            {families.map((f) => chip(f.key, f.label))}
          </nav>
        )}
      </header>

      {shown.length === 0 ? (
        <GcsCard>
          <p className="gcs-emptyState" data-testid="gcs-servers-empty">
            <GcsIcon name="fa-solid fa-server" className="gcs-emptyIcon" />
            {family ? t("emptyFilter") : t("empty")}
            {canAdd && (
              <>
                {" "}
                <Link href="/admin/gaming/servers/new">{t("emptyAdmin")}</Link>
              </>
            )}
          </p>
        </GcsCard>
      ) : (
        <GcsServerGrid servers={await cardsData(actor, shown)} />
      )}
    </GcsServerLiveProvider>
  );
}
