import { faCalendarPlus, faPlus } from "@fortawesome/free-solid-svg-icons";
import { BOT_GROUP_KEY } from "@gcs/core";
import { BOT_ACP_SECTION, BOT_CORE_FEATURES, BOT_WELCOME_SETTING, BOT_WELCOME_TITLE_SETTING, botFeatureOn } from "@gcs/modules";
import { GcsAvatar, GcsCard, GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsUploadInput } from "@/lib/ui-inputs";
import { UPLOAD_RULES } from "@/lib/ui-labels";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { forumGroups } from "../../_components/forum-groups";
import { botAvatarAction, renameBotAction, rescheduleBotPostAction, saveBotWelcomeAction, scheduleBotPostAction, toggleBotFeatureAction, unscheduleBotPostAction } from "./actions";
import { GcsBotScheduleForm } from "./GcsBotScheduleForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.bot"))("title") };
}

const card = { padding: 20, maxWidth: 820, display: "flex", flexDirection: "column", gap: 14 } as const;
const muted = { margin: 0, color: "var(--gcs-muted)", fontSize: 13 } as const;

/**
 * ACP › Sistem › Botul comunității (bot-stiri §1): contul-bot (nume; avatarul și culoarea grupului „Bot” ca la orice
 * membru / grup), ce funcții îl pot folosi (nucleul și pluginurile cu `bot.post`), mesajul de bun venit și postările
 * programate (listă + panou: „Postare nouă” și „Editează” deschid formularul; „Anulează” stă jos în panou).
 */
export default async function AcpBotPage() {
  const { actor } = await requireAcpSection(BOT_ACP_SECTION);
  const t = await getTranslations("acp.bot");
  const format = await getFormatter();
  const s = services();
  const [account, features, botGroup, plugins, welcomeTitle, welcomeText, scheduled, groups, canEdit, canDelete] = await Promise.all([
    s.communityBot.account(),
    s.communityBot.features(),
    s.db.group.findUnique({ where: { key: BOT_GROUP_KEY }, select: { id: true } }),
    s.communityBot.pluginUsers(),
    s.settings.get<string>(BOT_WELCOME_TITLE_SETTING),
    s.settings.get<string>(BOT_WELCOME_SETTING),
    s.communityBot.scheduled(actor),
    forumGroups(s.db),
    s.acp.can(actor, BOT_ACP_SECTION, "edit"),
    s.acp.can(actor, BOT_ACP_SECTION, "delete"),
  ]);
  const forumName = new Map(groups.flatMap((g) => g.forums).map((f) => [f.id, f.name]));
  const scheduleLabels = {
    forum: t("scheduled.forum"),
    title: t("scheduled.postTitle"),
    content: t("scheduled.content"),
    publishAt: t("scheduled.publishAt"),
    lock: t("scheduled.lock"),
    pin: t("scheduled.pin"),
    noCategory: t("scheduled.noCategory"),
    secPost: t("scheduled.secPost"),
    secWhen: t("scheduled.secWhen"),
  };
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
                <div className="gcs-field">
                  <span>{t("account.avatar")}</span>
                  {/* Trimisă cu formularul (Server Action: cel mult 1 MB), ca avatarul unui membru (WebP 512 × 512). */}
                  <GcsUploadInput
                    name="file"
                    title={t("account.avatar")}
                    rules={UPLOAD_RULES.image(1)}
                    current={account.image ? { url: account.image, name: account.name } : null}
                    required
                    testId="gcs-bot-avatar-input"
                  />
                </div>
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
            const on = botFeatureOn(features, row.key);
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
          <div className="gcs-botSched__head">
            <div>
              <h2 style={{ margin: 0, fontSize: 16 }}>{t("scheduled.title")}</h2>
              <p style={muted}>{t("scheduled.body")}</p>
            </div>
            {groups.length > 0 && canEdit && (
              <GcsAcpEditPanel label={t("scheduled.new")} variant="primary" buttonIcon={<GcsIconSvg icon={faPlus} />} title={t("scheduled.new")} titleIcon={<GcsIconSvg icon={faCalendarPlus} />} size="lg" testId="gcs-bot-schedule-new">
                <GcsBotScheduleForm groups={groups} action={scheduleBotPostAction} labels={{ ...scheduleLabels, submit: t("scheduled.submit") }} />
              </GcsAcpEditPanel>
            )}
          </div>
          {groups.length === 0 && <p style={muted}>{t("scheduled.noForums")}</p>}
          {scheduled.length === 0 ? (
            <p style={muted}>{t("scheduled.empty")}</p>
          ) : (
            <ul className="gcs-sysList gcs-botSched__list">
              {scheduled.map((p) => (
                <li key={p.id} className="gcs-sysList__row" data-testid="gcs-bot-scheduled-row" data-title={p.title}>
                  <span className="gcs-sysList__icon" aria-hidden="true">
                    <GcsIcon name={p.status === "posted" ? "fa-solid fa-circle-check" : p.status === "failed" ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-clock"} />
                  </span>
                  <span className="gcs-sysList__body">
                    <strong>{p.title}</strong>
                    <small>
                      {forumName.get(p.forumId) ?? `#${p.forumId}`} · {format.dateTime(new Date(p.publishAt), { dateStyle: "medium", timeStyle: "short" })}
                      {p.pin ? ` · ${t("scheduled.pin")}` : ""}
                      {p.lock ? ` · ${t("scheduled.lock")}` : ""}
                      {p.error ? ` · ${p.error}` : ""}
                    </small>
                  </span>
                  <span className={`gcs-sysChip gcs-sysChip--${p.status === "posted" ? "ok" : p.status === "failed" ? "down" : "warn"}`} data-state={p.status}>
                    {t(`scheduled.status.${p.status}`)}
                  </span>
                  {p.status === "posted" && p.topicId ? <a href={`/topic/${p.topicId}`}>{t("scheduled.open")}</a> : null}
                  {p.status !== "posted" && canEdit && (
                    <GcsAcpEditPanel
                      title={p.title}
                      titleIcon={<GcsIconSvg icon={faCalendarPlus} />}
                      size="lg"
                      testId="gcs-bot-schedule-edit"
                      footer={
                        canDelete ? (
                          <GcsActionForm action={unscheduleBotPostAction} submitLabel={t("scheduled.cancel")} submitKind="delete" variant="ghost" compact confirm={t("scheduled.cancelConfirm")}>
                            <input type="hidden" name="id" value={p.id} />
                          </GcsActionForm>
                        ) : undefined
                      }
                    >
                      <GcsBotScheduleForm
                        groups={groups}
                        action={rescheduleBotPostAction.bind(null, p.id)}
                        labels={{ ...scheduleLabels, submit: t("scheduled.save") }}
                        initial={{ forumId: p.forumId, title: p.title, content: p.content, publishAt: p.publishAt, lock: p.lock, pin: p.pin }}
                      />
                    </GcsAcpEditPanel>
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
