import { FORUMS_ACP_SECTION, gameDef, serverAddress, wizardGames, WIZARD_SUBFORUMS } from "@gcs/modules";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { iconDef } from "@/lib/servers";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { GcsServerWizard, type GcsWizardGame } from "./GcsServerWizard";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.serverWizard"))("title") };
}

/**
 * ACP › Comunitate › Forumuri › Creează categorie (macheta `ServerWizard`): o categorie simplă sau, cu aplicația Servere
 * pornită (premium, inclusă în licență), o categorie de servere în 4 pași (tipul, jocul, serverele și subforumurile,
 * confirmarea).
 */
export default async function NewCategoryPage() {
  const panel = await requireAcpSection(FORUMS_ACP_SECTION);
  const t = await getTranslations("acp.serverWizard");
  const { apps, servers, acp } = services();
  const serversOn = (await apps.enabled("servers")) && (await acp.can(panel.actor, "gaming.servers", "edit").catch(() => false));
  const rows = serversOn ? await servers.list() : [];
  const games: GcsWizardGame[] = wizardGames().map((g) => ({ key: g.key, name: g.name, protocol: g.protocol, defaultPort: g.defaultPort, soon: !g.enabled, icon: iconDef(g.icon) }));
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-folder-plus" description={t("lead")}>
        {t("title")}
      </GcsAcpTitle>
      <GcsServerWizard
        serversAvailable={serversOn}
        games={games}
        existing={rows.map((r) => ({ id: r.id, name: r.name, game: r.game, address: serverAddress(gameDef(r.game), r.host, r.port), linked: r.forumId !== null }))}
        subforums={WIZARD_SUBFORUMS.map((k) => ({ key: k, name: t(`subs.${k}`), on: k !== "guides" && k !== "events" }))}
      />
    </>
  );
}
