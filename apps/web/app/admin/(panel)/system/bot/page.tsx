import { BOT_GROUP_KEY } from "@gcs/core";
import { BOT_ACP_SECTION, BOT_CORE_FEATURES, BOT_WELCOME_SETTING, BOT_WELCOME_TITLE_SETTING } from "@gcs/modules";
import { GcsAvatar, GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { botAvatarAction, renameBotAction, saveBotWelcomeAction, scheduleBotPostAction, toggleBotFeatureAction, unscheduleBotPostAction } from "./actions";
import { GcsBotScheduleForm } from "./GcsBotScheduleForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.bot"))("title") };
}

const card = { padding: 20, maxWidth: 820, display: "flex", flexDirection: "column", gap: 14 } as const;
const muted = { margin: 0, color: "var(--gcs-muted)", fontSize: 13 } as const;

/**
 * ACP › Sistem › Botul comunității (bot-stiri §1): contul-bot (nume; avatarul și culoarea grupului „Bot” ca la orice
 * membru / grup), ce funcții îl pot folosi (nucleul și pluginurile cu `bot.post`), mesajul de bun venit și postările
 * programate.
 */
export default async function AcpBotPage() {
  const { actor } = await requireAcpSection(BOT_ACP_SECTION);
  const t = await getTranslations("acp.bot");
  const format = await getFormatter();
  const s = services();
  const [account, features, botGroup, plugins, welcomeTitle, welcomeText, scheduled, forums] = await Promise.all([
    s.communityBot.account(),
    s.communityBot.features(),
    s.db.group.findUnique({ where: { key: BOT_GROUP_KEY }, select: { id: true } }),
    s.communityBot.pluginUsers(),
    s.settings.get<string>(BOT_WELCOME_TITLE_SETTING),
    s.settings.get<string>(BOT_WELCOME_SETTING),
    s.communityBot.scheduled(actor),
    s.db.forum.findMany({ where: { type: { in: ["FORUM", "QA"] } }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
  ]);
  const forumName = new Map(forums.map((f) => [f.id, f.name]));
  const rows = [
    ...BOT_CORE_FEATURES.map((key) => ({ key, title: t(`features.${key}.title`), body: t(`features.${key}.body`) })),
    ...plugins.map((p) => ({ key: p.feature, title: p.name, body: t("features.plugin") })),
  ];

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-robot">{t("title")}</GcsAcpTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <GcsCard style={card} data-testid="gcs-bot-account">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("account.title")}</h2>
          {account ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <GcsAvatar name={account.name} size="m" {...(account.image ? { src: account.image } : {})} />
                <div>
                  <strong data-testid="gcs-bot-name">{account.name}</strong>
                  <p style={muted}>{t("account.body")}</p>
                </div>
              </div>
              <GcsActionForm action={renameBotAction} submitLabel={t("account.save")} submitKind="save">
                <label className="gcs-field">
                  <span>{t("account.name")}</span>
                  <input className="gcs-input" name="name" defaultValue={account.name} minLength={2} maxLength={40} required data-testid="gcs-bot-name-input" />
                </label>
              </GcsActionForm>
              <GcsActionForm action={botAvatarAction} submitLabel={t("account.avatarSave")} submitKind="save" variant="ghost">
                <label className="gcs-field">
                  <span>{t("account.avatar")}</span>
                  <input className="gcs-input" type="file" name="file" accept="image/png,image/jpeg,image/webp,image/gif" required data-testid="gcs-bot-avatar-input" />
                </label>
              </GcsActionForm>
              {botGroup && (
                <p style={muted}>
                  <a href={`/admin/groups/${botGroup.id}`}>{t("account.group")}</a>
                </p>
              )}
            </>
          ) : (
            <p style={muted}>{t("account.missing")}</p>
          )}
        </GcsCard>

        <GcsCard style={card} data-testid="gcs-bot-features">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("features.title")}</h2>
          <p style={muted}>{t("features.body")}</p>
          {rows.map((row) => {
            const on = features[row.key] !== false;
            return (
              <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 14, borderTop: "1px solid var(--gcs-border)", paddingTop: 12 }} data-testid={`gcs-bot-feature-${row.key}`}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{row.title}</strong>
                  <p style={muted}>{row.body}</p>
                </div>
                <span className={`gcs-badge${on ? " gcs-badge--ok" : ""}`} data-state={on ? "on" : "off"}>
                  {on ? t("features.on") : t("features.off")}
                </span>
                <GcsActionForm action={toggleBotFeatureAction} submitLabel={on ? t("features.disable") : t("features.enable")} variant="ghost" compact>
                  <input type="hidden" name="feature" value={row.key} />
                  <input type="hidden" name="on" value={on ? "0" : "1"} />
                </GcsActionForm>
              </div>
            );
          })}
        </GcsCard>

        <GcsCard style={card} data-testid="gcs-bot-welcome">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("welcome.title")}</h2>
          <p style={muted}>{t("welcome.body")}</p>
          <GcsActionForm action={saveBotWelcomeAction} submitLabel={t("welcome.save")} submitKind="save">
            <label className="gcs-field">
              <span>{t("welcome.subject")}</span>
              <input className="gcs-input" name="title" defaultValue={welcomeTitle} maxLength={150} required />
            </label>
            <label className="gcs-field">
              <span>{t("welcome.text")}</span>
              <textarea className="gcs-input" name="text" rows={6} defaultValue={welcomeText} maxLength={5000} required />
            </label>
          </GcsActionForm>
        </GcsCard>

        <GcsCard style={card} data-testid="gcs-bot-scheduled">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("scheduled.title")}</h2>
          <p style={muted}>{t("scheduled.body")}</p>
          {forums.length > 0 ? (
            <GcsBotScheduleForm
              forums={forums}
              action={scheduleBotPostAction}
              labels={{
                forum: t("scheduled.forum"),
                title: t("scheduled.postTitle"),
                content: t("scheduled.content"),
                publishAt: t("scheduled.publishAt"),
                lock: t("scheduled.lock"),
                pin: t("scheduled.pin"),
                submit: t("scheduled.submit"),
              }}
            />
          ) : (
            <p style={muted}>{t("scheduled.noForums")}</p>
          )}
          {scheduled.length === 0 ? (
            <p style={muted}>{t("scheduled.empty")}</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {scheduled.map((p) => (
                <li key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", borderTop: "1px solid var(--gcs-border)", paddingTop: 10 }} data-testid="gcs-bot-scheduled-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{p.title}</strong>
                    <p style={muted}>
                      {forumName.get(p.forumId) ?? `#${p.forumId}`} · {format.dateTime(new Date(p.publishAt), { dateStyle: "medium", timeStyle: "short" })}
                      {p.error ? ` · ${p.error}` : ""}
                    </p>
                  </div>
                  <span className={`gcs-badge${p.status === "posted" ? " gcs-badge--ok" : ""}`} data-state={p.status}>
                    {t(`scheduled.status.${p.status}`)}
                  </span>
                  {p.status === "posted" && p.topicId ? <a href={`/topic/${p.topicId}`}>{t("scheduled.open")}</a> : null}
                  {p.status !== "posted" && (
                    <GcsActionForm action={unscheduleBotPostAction} submitLabel={t("scheduled.cancel")} submitKind="delete" variant="ghost" compact confirm={t("scheduled.cancelConfirm")}>
                      <input type="hidden" name="id" value={p.id} />
                    </GcsActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </GcsCard>
      </div>
    </>
  );
}
