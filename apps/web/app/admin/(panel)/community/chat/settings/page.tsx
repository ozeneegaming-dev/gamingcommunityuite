import { CHAT_ACP_SETTINGS, CHAT_DISPLAY_SETTINGS } from "@gcs/modules";
import { GcsCard, GcsUserLink } from "@gcs/ui";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsSettingsForm, type GcsSettingsField } from "../../../_components/GcsSettingsForm";
import { liftChatMute, saveChatSettings, saveChatWordFilter } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.chat"))("settingsTitle") };
}

/** ACP → Comunitate → Chat → Setări: afișarea, limitele și conținutul permis (ca în Chatbox-ul IPS), filtrul de cuvinte și mute-urile active. */
export default async function AcpChatSettingsPage() {
  await requireAcpSection(CHAT_ACP_SETTINGS);
  const [t, format, tSettings, tAll] = await Promise.all([getTranslations("acp.chat"), getFormatter(), getTranslations("acp.settings"), getTranslations()]);
  const { settings, chatQueries } = services();
  const [words, mutes] = await Promise.all([settings.get<string[]>("chat.word_filter"), chatQueries.activeMutes()]);
  const label = (key: string) => (tAll.has(key) ? tAll(key) : key);
  const fields: GcsSettingsField[] = await Promise.all(
    CHAT_DISPLAY_SETTINGS.map(async (def) => {
      const value = await settings.get(def.key);
      const f: GcsSettingsField = { key: def.key, label: label(def.labelKey), type: def.type, value: def.type === "secret" ? "" : value };
      if (def.type === "secret") f.secretSet = typeof value === "string" && value !== "";
      if (def.options) f.options = def.options.map((o) => ({ value: o, label: label(`settings.choices.${o}`) }));
      if (def.multiline) f.multiline = true;
      return f;
    }),
  );

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t("settingsTitle")}
      </h1>
      <GcsCard as="section" aria-labelledby="gcs-chat-display" style={{ padding: 16, maxWidth: 720 }} data-testid="gcs-acp-chat-settings">
        <h2 id="gcs-chat-display" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          {t("display")}
        </h2>
        <GcsSettingsForm
          fields={fields}
          action={saveChatSettings}
          labels={{ save: t("save"), saved: tAll("acp.saved"), secretSet: tSettings("secretSet"), secretEmpty: tSettings("secretEmpty"), on: tSettings("on") }}
        />
      </GcsCard>
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
