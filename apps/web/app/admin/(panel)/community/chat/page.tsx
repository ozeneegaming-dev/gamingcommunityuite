import { CHAT_ACP_CHANNELS } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { createChatChannel, deleteChatChannel, removeAnnouncement, updateChatChannel } from "./actions";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";
import { GcsMemberLink } from "@/lib/member-names";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.chat"))("title") };
}

type Channel = { key: string; name: string; description: string; slowModeSeconds: number; retentionDays: number; enabled: boolean; showOnHome: boolean };

const ROW = { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" } as const;

/** ACP → Comunitate → Chat → Canale (specul etapei 4 §9): canalele, cu setările lor și linkul la permisiuni. */
export default async function AcpChatChannelsPage() {
  await requireAcpSection(CHAT_ACP_CHANNELS);
  const t = await getTranslations("acp.chat");
  const { db, chatQueries } = services();
  const [channels, announcements] = await Promise.all([
    db.chatChannel.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], include: { owner: { select: { id: true, name: true } } } }),
    chatQueries.announcements(),
  ]);

  const fields = (c?: Channel) => (
    <>
      <label className="gcs-field" style={{ width: 180 }}>
        {t("name")}
        <input className="gcs-input" name="name" defaultValue={c?.name ?? ""} required maxLength={50} />
      </label>
      <label className="gcs-field" style={{ minWidth: 220, flex: 1 }}>
        {t("description")}
        <input className="gcs-input" name="description" defaultValue={c?.description ?? ""} maxLength={200} />
      </label>
      <label className="gcs-field" style={{ width: 130 }}>
        {t("slowMode")}
        <input className="gcs-input" name="slowModeSeconds" type="number" min={0} max={3600} defaultValue={c?.slowModeSeconds ?? 0} />
      </label>
      <label className="gcs-field" style={{ width: 130 }}>
        {t("retention")}
        <input className="gcs-input" name="retentionDays" type="number" min={1} max={365} defaultValue={c?.retentionDays ?? 7} />
      </label>
      <label className="gcs-checkRow">
        <input type="checkbox" name="enabled" defaultChecked={c?.enabled ?? true} />
        {t("enabled")}
      </label>
      <label className="gcs-checkRow">
        <input type="checkbox" name="showOnHome" defaultChecked={c?.showOnHome ?? false} />
        {t("showOnHome")}
      </label>
    </>
  );

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-hashtag">
        {t("title")}
      </GcsAcpTitle>
      <GcsCard as="section" aria-label={t("title")} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        {channels.map((c) => (
          <div
            key={c.key}
            style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 12, borderBottom: "1px solid var(--gcs-border)" }}
            data-testid={`gcs-acp-chat-${c.key}`}
          >
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <strong>#{c.key}</strong>
              {c.type === "PRIVATE" && <span className="gcs-badge">{t("private")}</span>}
              {c.owner && <span className="gcs-muted">{t.rich("owner", { name: () => <GcsMemberLink user={c.owner!} /> })}</span>}
              <Link href={`/admin/permissions/chat/${c.key}`}>{t("permissions")}</Link>
            </div>
            <div style={ROW}>
              <GcsActionForm action={updateChatChannel.bind(null, c.key)} submitLabel={t("save")} submitKind="save" style={ROW}>
                {fields(c)}
              </GcsActionForm>
              <GcsActionForm action={deleteChatChannel.bind(null, c.key)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete", { name: c.name })} />
            </div>
          </div>
        ))}
      </GcsCard>
      <GcsCard as="section" aria-labelledby="gcs-chat-announcements" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 id="gcs-chat-announcements" className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name="fa-solid fa-bullhorn" />
          {t("announcements")}
        </h2>
        {announcements.length === 0 && <p className="gcs-muted" style={{ margin: 0 }}>{t("noAnnouncements")}</p>}
        {announcements.map((a) => (
          <div key={a.id} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }} data-testid="gcs-acp-announcement">
            <span style={{ flex: 1 }}>{a.body}</span>
            <span className="gcs-muted">{a.expiresAt ? t("until", { date: new Date(a.expiresAt).toLocaleString() }) : t("noExpiry")}</span>
            <GcsActionForm action={removeAnnouncement.bind(null, a.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact />
          </div>
        ))}
      </GcsCard>
      <GcsCard as="section" aria-labelledby="gcs-chat-create" style={{ padding: 16 }}>
        <h2 id="gcs-chat-create" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          <GcsAcpTitleIcon name="fa-solid fa-plus" />
          {t("create")}
        </h2>
        <GcsActionForm action={createChatChannel} submitLabel={t("create")} submitKind="create" style={ROW}>
          <label className="gcs-field" style={{ width: 140 }}>
            {t("key")}
            <input className="gcs-input" name="key" required pattern="[a-z0-9][a-z0-9\-]{1,31}" />
          </label>
          {fields()}
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
