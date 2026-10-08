import { gameDef, SERVERS_ACP_SECTION } from "@gcs/modules";
import { GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { iconDef } from "@/lib/servers";
import { services } from "@/lib/services";
import { serverHref } from "@/app/(site)/_components/servers/types";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";
import { GcsEnrollments } from "./GcsEnrollments";
import { GcsPluginDownload } from "./GcsPluginDownload";
import { GcsServerOrder } from "./GcsServerOrder";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.servers"))("title") };
}

/**
 * ACP → Gaming → Servere (specul 2026-10-07-servere §6): lista în ordinea de pe site, cu statusul curent; pluginul general
 * (fără cheie) și serverele noi detectate prin înrolarea automată (specul 2026-10-08-servere-plugin-v2 §5).
 */
export default async function AcpServersPage() {
  const { actor } = await requireAcpSection(SERVERS_ACP_SECTION);
  const { servers, bridge, acp } = services();
  const [t, ts, te, format, list, enrollments, canEdit] = await Promise.all([
    getTranslations("acp.servers"),
    getTranslations("servers"),
    getTranslations("acp.servers.enroll"),
    getFormatter(),
    servers.list(),
    bridge.enrollments.list(actor),
    acp.can(actor, SERVERS_ACP_SECTION, "edit"),
  ]);
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const rows = list.map((s) => {
    const game = gameDef(s.game);
    const port = s.port;
    return {
      id: s.id,
      name: s.name,
      href: serverHref(s),
      gameName: game?.name ?? s.game,
      gameIcon: iconDef(game?.icon ?? "fa-solid fa-server"),
      address: `${s.host.includes(":") ? `[${s.host}]` : s.host}:${port}`,
      enabled: s.enabled,
      restricted: s.restricted,
      online: s.status?.online === true,
      status: !s.status ? t("statusNone") : s.status.online ? t("statusOnline", { players: s.status.players, max: s.status.maxPlayers }) : ts("status.offline"),
    };
  });

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-server"
        description={t("lead")}
        actions={
          <GcsButton variant="primary" asChild icon={<GcsIcon name="fa-solid fa-plus" />}>
            <Link href="/admin/gaming/servers/new" data-testid="gcs-acp-server-add">
              {t("add")}
            </Link>
          </GcsButton>
        }
      >
        {t("title")}
      </GcsAcpTitle>
      <GcsCard as="section" aria-label={t("title")} style={{ padding: 16 }}>
        {rows.length === 0 ? (
          <p className="gcs-muted" style={{ margin: 0 }}>
            {t("empty")}
          </p>
        ) : (
          // Lista se reinițializează când se schimbă serverele (ex. după adăugare sau ștergere).
          <GcsServerOrder key={rows.map((r) => `${r.id}:${r.name}:${r.enabled}`).join(",")} servers={rows} />
        )}
      </GcsCard>

      <GcsCard as="section" aria-labelledby="gcs-enroll-title" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-enroll-card">
        <h2 id="gcs-enroll-title" className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name="fa-solid fa-satellite-dish" />
          {te("title")}
        </h2>
        <p className="gcs-muted" style={{ margin: 0, fontSize: 14 }}>
          {te("lead")}
        </p>
        <GcsEnrollments
          key={enrollments.map((e) => `${e.id}:${e.status}:${e.check?.result ?? ""}`).join(",")}
          items={enrollments.map((e) => ({ ...e, firstSeenLabel: when(e.createdAt), lastSeenLabel: when(e.lastSeenAt), gameName: gameDef(e.game)?.name ?? e.game }))}
          servers={list.map((s) => ({ id: s.id, name: s.name, game: s.game }))}
          canEdit={canEdit}
        />
      </GcsCard>

      <GcsCard as="section" aria-labelledby="gcs-general-plugin" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 id="gcs-general-plugin" className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name="fa-solid fa-puzzle-piece" />
          {t("general.title")}
        </h2>
        <p className="gcs-muted" style={{ margin: 0, fontSize: 14 }}>
          {t("general.lead")}
        </p>
        {canEdit && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <GcsPluginDownload game="cs16" label={t("general.cs16")} testId="gcs-general-plugin-cs16" />
            <GcsPluginDownload game="cs2" label={t("general.cs2")} testId="gcs-general-plugin-cs2" />
          </div>
        )}
      </GcsCard>
    </>
  );
}
