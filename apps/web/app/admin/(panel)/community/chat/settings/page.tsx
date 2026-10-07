import { APPS_ACP_SECTION, GCS_RICH_FIELDS } from "@gcs/core";
import { CHAT_ACP_SETTINGS, CHAT_CONTAINER } from "@gcs/modules";
import { GcsCard, GcsUserLink } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { liftChatMute, saveChatPermissions, saveChatSettings, saveChatWordFilter } from "../actions";
import { GcsChatSettingsForm, type GcsChatSettingRow } from "./GcsChatSettingsForm";
import { GcsChatSettingsTabs } from "./GcsChatSettingsTabs";
import { POLL_FIELD } from "./tabs";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.chat"))("settingsTitle") };
}

const GENERAL_CHANNEL = "general";

/**
 * ACP → Comunitate → Chat → Setări, după chatbox-ul de referință (5.png–7.png): tab-urile General (aplicația
 * pornită, ora, ordinea, regulile, avatarele, înălțimea, Enter pe mobil), Avansat (Chat: mesaje, actualizare, flood,
 * limite; Media: imagini, YouTube, voce, GIPHY) și Permisiuni (cine citește / scrie în General, cine moderează).
 * Dedesubt: filtrul de cuvinte și mute-urile active.
 */
export default async function AcpChatSettingsPage() {
  const { actor } = await requireAcpSection(CHAT_ACP_SETTINGS);
  const [t, format, tSettings, tAll] = await Promise.all([getTranslations("acp.chat"), getFormatter(), getTranslations("acp.settings"), getTranslations()]);
  const { settings, chatQueries, apps, acp, db, registry } = services();
  const keys = [
    "chat.time_format",
    "chat.newest_on_top",
    "chat.show_rules",
    "chat.rules",
    "chat.hide_avatars",
    "chat.min_height",
    "chat.hide_enter_mobile",
    "chat.messages_to_display",
    "chat.poll_interval",
    "chat.flood_seconds",
    "chat.max_length",
    "chat.max_emoticons",
    "chat.allow_images",
    "chat.allow_youtube",
    "chat.voice_enabled",
    "chat.voice_max_seconds",
    "chat.giphy_key",
  ] as const;
  const [values, words, mutes, appOn, canToggleApp, canEditGroups, groups, channel, channelRows, moderateRows] = await Promise.all([
    Promise.all(keys.map((k) => settings.get(k))).then((list) => Object.fromEntries(keys.map((k, i) => [k, list[i]])) as Record<(typeof keys)[number], unknown>),
    settings.get<string[]>("chat.word_filter"),
    chatQueries.activeMutes(),
    apps.enabled("chat"),
    acp.can(actor, APPS_ACP_SECTION, "edit"),
    acp.can(actor, "members.groups", "edit"),
    db.group.findMany({ orderBy: { position: "asc" }, select: { id: true, key: true, name: true } }),
    db.chatChannel.findUnique({ where: { key: GENERAL_CHANNEL }, select: { name: true } }),
    db.containerPermission.findMany({ where: { containerType: CHAT_CONTAINER, containerId: GENERAL_CHANNEL }, select: { groupId: true, action: true } }),
    db.groupSetting.findMany({ where: { key: "chat.moderate" }, select: { groupId: true, value: true } }),
  ]);
  const num = (k: (typeof keys)[number]) => (typeof values[k] === "number" ? (values[k] as number) : 0);
  const bool = (k: (typeof keys)[number]) => values[k] === true;
  const f = (key: string) => t(`form.${key}`);
  const unlimited = (fallback: number) => ({ or: f("or"), label: f("unlimited"), fallback });
  const saveLabels = { save: t("save"), saved: tAll("acp.saved") };

  const general: GcsChatSettingRow[] = [
    {
      kind: "switch",
      key: "app.chat",
      name: "app:chat",
      label: f("enabled"),
      value: appOn,
      disabled: !canToggleApp,
      hint: canToggleApp ? f("enabledHint") : f("enabledNoRight"),
    },
    {
      kind: "select",
      key: "chat.time_format",
      label: f("timeFormat"),
      required: f("required"),
      value: String(values["chat.time_format"] ?? "24h"),
      options: ["24h", "12h"].map((o) => ({ value: o, label: tAll(`settings.choices.${o}`) })),
    },
    { kind: "switch", key: "chat.newest_on_top", label: f("newestOnTop"), hint: f("newestOnTopHint"), value: bool("chat.newest_on_top") },
    { kind: "switch", key: "chat.show_rules", label: f("showRules"), hint: f("showRulesHint"), value: bool("chat.show_rules") },
    // Regulile: editorul compact (profilul `chatRules`); un text vechi se deschide ca paragrafe.
    { kind: "rich", key: "chat.rules", label: f("rules"), hint: f("rulesHint"), value: values["chat.rules"] ?? "", allow: GCS_RICH_FIELDS.chatRules, maxLength: GCS_RICH_FIELDS.chatRules.maxChars },
    { kind: "switch", key: "chat.hide_avatars", label: f("hideAvatars"), value: bool("chat.hide_avatars") },
    { kind: "number", key: "chat.min_height", label: f("minHeight"), hint: f("minHeightHint"), value: num("chat.min_height"), min: 120, max: 1200, unit: "px" },
    { kind: "switch", key: "chat.hide_enter_mobile", label: f("hideEnterMobile"), hint: f("hideEnterMobileHint"), value: bool("chat.hide_enter_mobile") },
  ];

  const advanced: GcsChatSettingRow[] = [
    { kind: "section", title: f("chatting") },
    { kind: "number", key: "chat.messages_to_display", label: f("messages"), hint: f("messagesHint"), value: num("chat.messages_to_display"), min: 10, max: 100 },
    {
      kind: "number",
      key: "chat.poll_interval",
      name: POLL_FIELD,
      label: f("interval"),
      hint: f("intervalHint"),
      value: num("chat.poll_interval") * 1000,
      min: 5000,
      max: 600_000,
      step: 1000,
    },
    {
      kind: "number",
      key: "chat.flood_seconds",
      label: f("flood"),
      hint: f("floodHint"),
      value: num("chat.flood_seconds"),
      min: 0,
      max: 3600,
      unit: f("seconds"),
      none: { or: f("or"), label: f("none"), fallback: 10 },
    },
    { kind: "number", key: "chat.max_length", label: f("maxLength"), hint: f("maxLengthHint"), value: num("chat.max_length"), min: 0, max: 2000, none: unlimited(500) },
    { kind: "number", key: "chat.max_emoticons", label: f("maxEmoticons"), hint: f("maxEmoticonsHint"), value: num("chat.max_emoticons"), min: 0, max: 100, none: unlimited(5) },
    { kind: "section", title: f("media") },
    { kind: "switch", key: "chat.allow_images", label: f("allowImages"), hint: f("allowImagesHint"), value: bool("chat.allow_images") },
    { kind: "switch", key: "chat.allow_youtube", label: f("allowYoutube"), value: bool("chat.allow_youtube") },
    { kind: "switch", key: "chat.voice_enabled", label: f("voice"), value: bool("chat.voice_enabled") },
    { kind: "number", key: "chat.voice_max_seconds", label: f("voiceMax"), value: num("chat.voice_max_seconds"), min: 5, max: 300, unit: f("seconds") },
    {
      kind: "secret",
      key: "chat.giphy_key",
      label: f("giphy"),
      hint: `${typeof values["chat.giphy_key"] === "string" && values["chat.giphy_key"] !== "" ? tSettings("secretSet") : tSettings("secretEmpty")}\n${f("giphyHint")}`,
      set: typeof values["chat.giphy_key"] === "string" && values["chat.giphy_key"] !== "",
      placeholderSet: "••••••••",
    },
  ];

  // Permisiunile: matricea canalului General și `chat.moderate` pe grup (valoarea salvată sau cea implicită).
  const allowed = new Set(channelRows.map((r) => `${r.action}:${r.groupId}`));
  const moderateDef = registry.permissionDef("chat.moderate");
  const moderateStored = new Map(moderateRows.map((r) => [r.groupId, r.value]));
  const moderates = (g: { id: number; key: string }) => (moderateStored.has(g.id) ? moderateStored.get(g.id) : moderateDef?.default[g.key]) === true;
  const columns = [
    { action: "chat.read", label: f("permRead") },
    { action: "chat.write", label: f("permWrite") },
    { action: "chat.moderate", label: f("permModerate") },
  ];
  const permissions = channel ? (
    <GcsActionForm action={saveChatPermissions} submitLabel={t("save")}>
      <fieldset disabled={!canEditGroups} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend className="gcs-chatAcp__hint" style={{ marginBottom: 8 }}>
          {f("permIntro")}
        </legend>
        <div className="gcs-table">
          <table className="gcs-table__table gcs-chatAcp__matrix">
            <caption className="gcs-srOnly">{f("permCaption")}</caption>
            <thead>
              <tr>
                <th className="gcs-table__th" scope="col">
                  {f("permGroup")}
                </th>
                {columns.map((c) => (
                  <th key={c.action} className="gcs-table__th" scope="col">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id} className="gcs-table__row" data-testid={`gcs-acp-chat-perm-${g.key}`}>
                  <th className="gcs-table__td" scope="row">
                    <span className={`gcs-name--${g.key}`}>{g.name}</span>
                  </th>
                  {columns.map((c) => (
                    <td key={c.action} className="gcs-table__td">
                      <input
                        type="checkbox"
                        role="switch"
                        className="gcs-chat__switch"
                        name={`${c.action}:${g.id}`}
                        defaultChecked={c.action === "chat.moderate" ? moderates(g) : allowed.has(`${c.action}:${g.id}`)}
                        aria-label={`${g.name}: ${c.label}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
      {!canEditGroups && <p className="gcs-chatAcp__hint">{f("permNoRight")}</p>}
    </GcsActionForm>
  ) : (
    <p className="gcs-muted">{f("permNoGeneral")}</p>
  );

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
        <GcsIcon name="fa-solid fa-comments" />
        {t("settingsTitle")}
      </h1>
      <GcsCard as="section" className="gcs-chatAcp" aria-label={t("settingsTitle")} style={{ maxWidth: 1000 }} data-testid="gcs-acp-chat-settings">
        <GcsChatSettingsTabs
          label={t("settingsTitle")}
          tabs={[
            {
              key: "general",
              label: f("tabGeneral"),
              icon: <GcsIcon name="fa-solid fa-sliders" />,
              content: <GcsChatSettingsForm rows={general} action={saveChatSettings.bind(null, "general")} labels={saveLabels} hidden={canToggleApp ? { "app:present": "1" } : undefined} />,
            },
            {
              key: "advanced",
              label: f("tabAdvanced"),
              icon: <GcsIcon name="fa-solid fa-gears" />,
              content: <GcsChatSettingsForm rows={advanced} action={saveChatSettings.bind(null, "advanced")} labels={saveLabels} />,
            },
            {
              key: "permissions",
              label: f("tabPermissions"),
              icon: <GcsIcon name="fa-solid fa-user-shield" />,
              content: (
                <div className="gcs-chatAcp__body">
                  <h3 className="gcs-acpWidget__title" style={{ margin: 0 }}>
                    {t("form.permTitle", { name: channel?.name ?? "General" })}
                  </h3>
                  {permissions}
                  <p className="gcs-chatAcp__hint">
                    <Link href={`/admin/permissions/chat/${GENERAL_CHANNEL}`}>{f("permFull")}</Link> · <Link href="/admin/community/chat">{f("permChannels")}</Link>
                  </p>
                </div>
              ),
            },
          ]}
        />
      </GcsCard>
      <GcsCard as="section" aria-labelledby="gcs-chat-filter" style={{ padding: 16, maxWidth: 1000 }}>
        <h2 id="gcs-chat-filter" className="gcs-acpWidget__title" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <GcsIcon name="fa-solid fa-filter" />
          {t("filter")}
        </h2>
        <GcsActionForm action={saveChatWordFilter} submitLabel={t("save")}>
          <label className="gcs-field">
            {t("filterHint")}
            <textarea className="gcs-input" name="words" rows={8} defaultValue={(Array.isArray(words) ? words : []).join("\n")} />
          </label>
        </GcsActionForm>
      </GcsCard>
      <GcsCard as="section" aria-labelledby="gcs-chat-mutes" style={{ padding: 16, maxWidth: 1000 }}>
        <h2 id="gcs-chat-mutes" className="gcs-acpWidget__title" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <GcsIcon name="fa-solid fa-comment-slash" />
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
