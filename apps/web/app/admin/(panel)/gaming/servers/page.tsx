import { gameDef, SERVERS_ACP_SECTION } from "@gcs/modules";
import { GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { iconDef } from "@/lib/servers";
import { services } from "@/lib/services";
import { serverHref } from "@/app/(site)/_components/servers/types";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { GcsServerOrder } from "./GcsServerOrder";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.servers"))("title") };
}

/** ACP → Gaming → Servere (specul 2026-10-07-servere §6): lista în ordinea de pe site, cu statusul curent. */
export default async function AcpServersPage() {
  await requireAcpSection(SERVERS_ACP_SECTION);
  const [t, ts, list] = await Promise.all([getTranslations("acp.servers"), getTranslations("servers"), services().servers.list()]);
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
    </>
  );
}
