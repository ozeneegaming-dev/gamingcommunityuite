import { CHAT_ACP_SETTINGS } from "@gcs/modules";
import { GcsCard, GcsUserLink } from "@gcs/ui";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { liftChatMute, saveChatWordFilter } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.chat"))("settingsTitle") };
}

/** ACP → Comunitate → Chat → Setări: filtrul de cuvinte și mute-urile active. */
export default async function AcpChatSettingsPage() {
  await requireAcpSection(CHAT_ACP_SETTINGS);
  const [t, format] = await Promise.all([getTranslations("acp.chat"), getFormatter()]);
  const { settings, chatQueries } = services();
  const [words, mutes] = await Promise.all([settings.get<string[]>("chat.word_filter"), chatQueries.activeMutes()]);

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t("settingsTitle")}
      </h1>
      <GcsCard as="section" aria-labelledby="gcs-chat-filter" style={{ padding: 16, maxWidth: 720 }}>
        <h2 id="gcs-chat-filter" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          {t("filter")}
        </h2>
        <GcsActionForm action={saveChatWordFilter} submitLabel={t("save")}>
          <label className="gcs-field">
            {t("filterHint")}
            <textarea className="gcs-input" name="words" rows={8} defaultValue={(Array.isArray(words) ? words : []).join("\n")} />
          </label>
        </GcsActionForm>
      </GcsCard>
      <GcsCard as="section" aria-labelledby="gcs-chat-mutes" style={{ padding: 16 }}>
        <h2 id="gcs-chat-mutes" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          {t("mutes")}
        </h2>
        {mutes.length === 0 ? (
          <p className="gcs-muted">{t("noMutes")}</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {mutes.map((m) => (
              <li key={m.id} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }} data-testid="gcs-acp-mute">
                <GcsUserLink userId={m.user.id} name={m.user.name} nameKey={m.user.nameKey} href={memberHref(m.user)} />
                <span className="gcs-muted">{m.channel ? `#${m.channel}` : t("allChannels")}</span>
                <span className="gcs-muted">
                  {m.until ? t("until", { date: format.dateTime(new Date(m.until), { dateStyle: "medium", timeStyle: "short" }) }) : t("permanent")}
                </span>
                {m.reason && <span>{m.reason}</span>}
                <GcsActionForm action={liftChatMute.bind(null, m.id)} submitLabel={t("lift")} variant="ghost" compact />
              </li>
            ))}
          </ul>
        )}
      </GcsCard>
    </>
  );
}
