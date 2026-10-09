import { APPS_ACP_SECTION } from "@gcs/core";
import { CHAT_PRO_ACP_SETTINGS, CHAT_PRO_COMMANDS } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { GcsChatSettingsForm, type GcsChatSettingRow } from "../chat/settings/GcsChatSettingsForm";
import { GcsChatSettingsTabs } from "../chat/settings/GcsChatSettingsTabs";
import { saveChatProSettings } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.chatPro"))("title") };
}

/**
 * ACP → Comunitate → Chat Pro → Setări: tab-urile General (aplicația pornită, perioada clasamentului, ziua resetării,
 * pauza de numărare, comenzile botului, ritmul barei), GIF-uri (furnizorul și cheia API; fără cheie nu există butonul
 * GIF), Memento de vot (oprit implicit) și Emoticoane (limitele încărcării). Linkuri spre bara de anunțuri și pachete.
 */
export default async function AcpChatProPage() {
  const { actor } = await requireAcpSection(CHAT_PRO_ACP_SETTINGS);
  const [t, tAll, tSettings] = await Promise.all([getTranslations("acp.chatPro"), getTranslations(), getTranslations("acp.settings")]);
  const { settings, apps, acp } = services();
  const keys = [
    "chat_pro.ranking_period",
    "chat_pro.ranking_reset_day",
    "chat_pro.count_cooldown",
    "chat_pro.commands",
    "chat_pro.bar_seconds",
    "chat_pro.gif_provider",
    "chat_pro.gif_key",
    "chat_pro.vote_enabled",
    "chat_pro.vote_text",
    "chat_pro.vote_url",
    "chat_pro.vote_interval",
    "chat_pro.emote_max_kb",
    "chat_pro.emote_max_side",
  ] as const;
  const [values, catalog, chatOn, canToggleApp] = await Promise.all([
    Promise.all(keys.map((k) => settings.get(k))).then((list) => Object.fromEntries(keys.map((k, i) => [k, list[i]])) as Record<(typeof keys)[number], unknown>),
    apps.catalog(),
    apps.enabled("chat"),
    acp.can(actor, APPS_ACP_SECTION, "edit"),
  ]);
  const own = catalog.find((a) => a.key === "chat_pro")?.enabled ?? false;
  const num = (k: (typeof keys)[number]) => (typeof values[k] === "number" ? (values[k] as number) : 0);
  const str = (k: (typeof keys)[number]) => (typeof values[k] === "string" ? (values[k] as string) : "");
  const commands = Array.isArray(values["chat_pro.commands"]) ? (values["chat_pro.commands"] as string[]) : [];
  const f = (key: string) => t(`form.${key}`);
  const saveLabels = { save: t("save"), saved: tAll("acp.saved") };
  const keySet = str("chat_pro.gif_key") !== "";

  const general: GcsChatSettingRow[] = [
    {
      kind: "switch",
      key: "app.chat_pro",
      name: "app:chat_pro",
      label: f("enabled"),
      value: own,
      disabled: !canToggleApp || (!own && !chatOn),
      hint: !chatOn ? f("needsChat") : canToggleApp ? f("enabledHint") : f("enabledNoRight"),
    },
    { kind: "section", title: f("ranking") },
    {
      kind: "select",
      key: "chat_pro.ranking_period",
      label: f("period"),
      value: str("chat_pro.ranking_period") || "month",
      options: ["month", "week"].map((o) => ({ value: o, label: f(`periods.${o}`) })),
    },
    { kind: "number", key: "chat_pro.ranking_reset_day", label: f("resetDay"), hint: f("resetDayHint"), value: num("chat_pro.ranking_reset_day"), min: 1, max: 28 },
    { kind: "number", key: "chat_pro.count_cooldown", label: f("cooldown"), hint: f("cooldownHint"), value: num("chat_pro.count_cooldown"), min: 0, max: 600, unit: f("seconds") },
    { kind: "section", title: f("commands") },
    ...CHAT_PRO_COMMANDS.map(
      (c): GcsChatSettingRow => ({ kind: "switch", key: `cmd.${c}`, name: `cmd:${c}`, label: f(`command.${c}`), hint: f(`command.${c}Hint`), value: commands.includes(c) }),
    ),
    { kind: "section", title: f("bar") },
    { kind: "number", key: "chat_pro.bar_seconds", label: f("barSeconds"), value: num("chat_pro.bar_seconds"), min: 3, max: 120, unit: f("seconds") },
  ];
  const gifs: GcsChatSettingRow[] = [
    {
      kind: "select",
      key: "chat_pro.gif_provider",
      label: f("gifProvider"),
      hint: f("gifProviderHint"),
      value: str("chat_pro.gif_provider") || "giphy",
      options: [
        { value: "giphy", label: "GIPHY" },
        { value: "tenor", label: "Tenor" },
      ],
    },
    {
      kind: "secret",
      key: "chat_pro.gif_key",
      label: f("gifKey"),
      hint: `${keySet ? tSettings("secretSet") : tSettings("secretEmpty")}\n${f("gifKeyHint")}`,
      set: keySet,
      placeholderSet: "••••••••",
    },
  ];
  const vote: GcsChatSettingRow[] = [
    { kind: "switch", key: "chat_pro.vote_enabled", label: f("voteEnabled"), hint: f("voteEnabledHint"), value: values["chat_pro.vote_enabled"] === true },
    { kind: "text", key: "chat_pro.vote_text", label: f("voteText"), value: str("chat_pro.vote_text"), maxLength: 200 },
    { kind: "text", key: "chat_pro.vote_url", label: f("voteUrl"), hint: f("urlHint"), value: str("chat_pro.vote_url"), maxLength: 300 },
    { kind: "number", key: "chat_pro.vote_interval", label: f("voteInterval"), value: num("chat_pro.vote_interval"), min: 5, max: 1440, unit: f("minutes") },
  ];
  const emotes: GcsChatSettingRow[] = [
    { kind: "number", key: "chat_pro.emote_max_kb", label: f("emoteKb"), value: num("chat_pro.emote_max_kb"), min: 16, max: 2048, unit: "KB" },
    { kind: "number", key: "chat_pro.emote_max_side", label: f("emoteSide"), hint: f("emoteSideHint"), value: num("chat_pro.emote_max_side"), min: 32, max: 512, unit: "px" },
  ];

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-wand-magic-sparkles">{t("title")}</GcsAcpTitle>
      <p className="gcs-muted" style={{ margin: 0, maxWidth: 1000 }}>
        {t("intro")} <Link href="/admin/community/chat-pro/bar">{t("barLink")}</Link> · <Link href="/admin/community/chat-pro/emotes">{t("emotesLink")}</Link>
      </p>
      <GcsCard as="section" className="gcs-chatAcp" aria-label={t("title")} style={{ maxWidth: 1000 }} data-testid="gcs-acp-chatpro-settings">
        <GcsChatSettingsTabs
          label={t("title")}
          tabs={[
            {
              key: "general",
              label: f("tabGeneral"),
              icon: <GcsIcon name="fa-solid fa-sliders" />,
              content: <GcsChatSettingsForm rows={general} action={saveChatProSettings.bind(null, "general")} labels={saveLabels} hidden={canToggleApp ? { "app:present": "1" } : undefined} />,
            },
            {
              key: "gifs",
              label: f("tabGifs"),
              icon: <GcsIcon name="fa-solid fa-film" />,
              content: <GcsChatSettingsForm rows={gifs} action={saveChatProSettings.bind(null, "gifs")} labels={saveLabels} />,
            },
            {
              key: "vote",
              label: f("tabVote"),
              icon: <GcsIcon name="fa-solid fa-check-to-slot" />,
              content: <GcsChatSettingsForm rows={vote} action={saveChatProSettings.bind(null, "vote")} labels={saveLabels} />,
            },
            {
              key: "emotes",
              label: f("tabEmotes"),
              icon: <GcsIcon name="fa-solid fa-face-grin-stars" />,
              content: <GcsChatSettingsForm rows={emotes} action={saveChatProSettings.bind(null, "emotes")} labels={saveLabels} />,
            },
          ]}
        />
      </GcsCard>
    </>
  );
}
