import { gameDef, SERVERS_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { iconDef } from "@/lib/servers";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { serverFormData } from "../form-data";
import { GcsServerForm } from "../GcsServerForm";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.servers"))("editTitle") };
}

/** ACP → Gaming → Servere → Editează (un joc scos din catalog rămâne în listă, ca serverul să poată fi editat). */
export default async function AcpEditServerPage({ params }: Props) {
  await requireAcpSection(SERVERS_ACP_SECTION);
  const id = Number((await params).id);
  const server = Number.isInteger(id) ? await services().servers.get(id) : null;
  if (!server) notFound();
  const [t, data] = await Promise.all([getTranslations("acp.servers"), serverFormData()]);
  const current = gameDef(server.game);
  const games = data.games.some((g) => g.key === server.game) || !current ? data.games : [...data.games, { key: current.key, name: current.name, defaultPort: current.defaultPort, defaultQueryPort: current.defaultQueryPort ?? null, protocol: current.protocol, icon: iconDef(current.icon) }];
  return (
    <>
      <Link href="/admin/gaming/servers" className="gcs-acpBack">
        <GcsIcon name="fa-solid fa-arrow-left" />
        {t("back")}
      </Link>
      <GcsAcpTitle
        icon={current?.icon ?? "fa-solid fa-server"}
        description={server.name}
        actions={
          // Puntea (pluginul de server și cheile API) există doar pentru CS 1.6 și CS2.
          server.game === "cs16" || server.game === "cs2" ? (
            <Link href={`/admin/gaming/servers/${server.id}/bridge`} className="gcs-btn gcs-btn--ghost" data-testid="gcs-acp-server-bridge">
              <GcsIcon name="fa-solid fa-plug" />
              {t("bridgeLink")}
            </Link>
          ) : undefined
        }
      >
        {t("editTitle")}
      </GcsAcpTitle>
      <GcsCard as="section" aria-label={t("editTitle")} style={{ padding: 20 }}>
        <GcsServerForm
          values={{
            id: server.id,
            game: server.game,
            name: server.name,
            host: server.host,
            port: server.port,
            queryPort: server.queryPort,
            description: server.description,
            forumId: server.forumId,
            groups: server.groups,
            enabled: server.enabled,
            bannerUrl: server.bannerId ? `/files/${server.bannerId}` : null,
            admins: server.admins,
            query: server.query,
          }}
          games={games}
          forums={data.forums}
          groups={data.groups}
        />
      </GcsCard>
    </>
  );
}
