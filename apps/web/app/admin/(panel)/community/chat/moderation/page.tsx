import { CHAT_ACP_MODERATION, CHAT_MOD_REASONS_DEFAULT } from "@gcs/modules";
import { GcsCard, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { liftChatSanctionAcp, saveChatModSettings, undoChatModLog } from "../actions";
import { GcsAcpConfirmAction } from "../GcsChatModAcp";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.chatMod"))("moderationTitle") };
}

/**
 * ACP → Comunitate → Chat → Moderare: motivele gata scrise din dialogurile de moderare (și linia publică la un acces de
 * moderator dat), sancțiunile active cu „Ridică” și „Jurnal moderare chat” (cine / ce / cui / motivul / linkul
 * mesajului), cu „Anulează” pentru mute, kick și ban încă active.
 */
export default async function AcpChatModerationPage({ searchParams }: { searchParams: Promise<{ page?: string; action?: string }> }) {
  const { actor } = await requireAcpSection(CHAT_ACP_MODERATION);
  const sp = await searchParams;
  const [t, tm, format] = await Promise.all([getTranslations("acp.chatMod"), getTranslations("chat.mod"), getFormatter()]);
  const { chatModeration, settings, acp } = services();
  const [reasons, announce, sanctions, log, canEdit] = await Promise.all([
    settings.get<string[]>("chat.mod_reasons").catch(() => CHAT_MOD_REASONS_DEFAULT),
    settings.get<boolean>("chat.announce_grants").catch(() => true),
    chatModeration.activeSanctions(actor),
    chatModeration.log(actor, { page: Number(sp.page ?? "1") || 1, ...(sp.action ? { action: sp.action } : {}) }),
    acp.can(actor, CHAT_ACP_MODERATION, "edit"),
  ]);
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const who = (u: { id: string; name: string; nameKey: string; slug?: string } | null) =>
    u ? <GcsMemberName userId={u.id} name={u.name} nameKey={u.nameKey} href={memberHref(u as Parameters<typeof memberHref>[0])} /> : <span className="gcs-muted">{t("system")}</span>;
  const pageHref = (page: number) => `/admin/community/chat/moderation?${new URLSearchParams({ ...(sp.action ? { action: sp.action } : {}), page: String(page) })}`;

  return (
    <div className="gcs-acpChatMod" data-testid="gcs-acp-chat-moderation">
      <h1 className="gcs-display gcs-acpChatMod__title">
        <GcsIcon name="fa-solid fa-shield-halved" />
        {t("moderationTitle")}
      </h1>

      <GcsCard as="section" className="gcs-acpChatMod__card" aria-labelledby="gcs-chatmod-presets">
        <h2 id="gcs-chatmod-presets" className="gcs-acpWidget__title">
          <GcsIcon name="fa-solid fa-list-check" /> {t("presetsTitle")}
        </h2>
        <GcsActionForm action={saveChatModSettings} submitLabel={t("save")}>
          <label className="gcs-field">
            {t("reasonsHint")}
            <textarea className="gcs-input" name="reasons" rows={6} defaultValue={(Array.isArray(reasons) ? reasons : []).join("\n")} disabled={!canEdit} data-testid="gcs-acp-chat-reasons" />
          </label>
          <label className="gcs-checkRow">
            <input type="checkbox" name="setting:chat.announce_grants" defaultChecked={announce !== false} disabled={!canEdit} />
            {t("announceGrants")}
          </label>
        </GcsActionForm>
      </GcsCard>

      <GcsCard as="section" className="gcs-acpChatMod__card" aria-labelledby="gcs-chatmod-active">
        <h2 id="gcs-chatmod-active" className="gcs-acpWidget__title">
          <GcsIcon name="fa-solid fa-user-lock" /> {t("activeTitle")}
        </h2>
        {sanctions.length === 0 ? (
          <p className="gcs-muted">{t("noActive")}</p>
        ) : (
          <div className="gcs-table">
            <table className="gcs-table__table">
              <caption className="gcs-srOnly">{t("activeTitle")}</caption>
              <thead>
                <tr>
                  {[t("colMember"), t("colKind"), t("colRoom"), t("colUntil"), t("colReason"), t("colBy"), ""].map((h, i) => (
                    <th key={i} className="gcs-table__th" scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sanctions.map((s) => (
                  <tr key={s.ref} className="gcs-table__row" data-testid="gcs-acp-chat-sanction">
                    <td className="gcs-table__td">{who(s.user)}</td>
                    <td className="gcs-table__td">
                      <span className={`gcs-acpChatMod__kind gcs-acpChatMod__kind--${s.kind}`}>{tm(`kinds.${s.kind}`)}</span>
                      {s.kind === "slow" && <span className="gcs-muted"> · {tm("seconds", { count: s.seconds })}</span>}
                    </td>
                    <td className="gcs-table__td">{s.channelKey ? `#${s.channelKey}` : tm("allRooms")}</td>
                    <td className="gcs-table__td">{s.until ? when(s.until) : tm("dur.forever")}</td>
                    <td className="gcs-table__td">{s.reason || "—"}</td>
                    <td className="gcs-table__td">{who(s.by)}</td>
                    <td className="gcs-table__td">
                      {canEdit && (
                        <GcsAcpConfirmAction
                          label={t("lift")}
                          title={t("liftTitle")}
                          body={t("liftBody", { name: s.user.name })}
                          confirm={t("lift")}
                          run={liftChatSanctionAcp.bind(null, s.ref)}
                          testId="gcs-acp-chat-lift"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GcsCard>

      <GcsCard as="section" className="gcs-acpChatMod__card" aria-labelledby="gcs-chatmod-log">
        <h2 id="gcs-chatmod-log" className="gcs-acpWidget__title">
          <GcsIcon name="fa-solid fa-clock-rotate-left" /> {t("logTitle")}
        </h2>
        {log.rows.length === 0 ? (
          <p className="gcs-muted">{t("noLog")}</p>
        ) : (
          <div className="gcs-table">
            <table className="gcs-table__table">
              <caption className="gcs-srOnly">{t("logTitle")}</caption>
              <thead>
                <tr>
                  {[t("colWhen"), t("colWho"), t("colWhat"), t("colWhom"), t("colReason"), t("colMessage"), ""].map((h, i) => (
                    <th key={i} className="gcs-table__th" scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {log.rows.map((r) => (
                  <tr key={r.id} className="gcs-table__row" data-testid="gcs-acp-chat-log-row" data-action={r.action}>
                    <td className="gcs-table__td">
                      <time dateTime={r.createdAt}>{when(r.createdAt)}</time>
                    </td>
                    <td className="gcs-table__td">{who(r.actor)}</td>
                    <td className="gcs-table__td">
                      {tm(`actions.${r.action}`)}
                      {r.undoneAt && <span className="gcs-muted"> · {t("undone")}</span>}
                    </td>
                    <td className="gcs-table__td">{r.target ? who(r.target) : "—"}</td>
                    <td className="gcs-table__td">{r.reason || "—"}</td>
                    <td className="gcs-table__td">
                      {r.messageId && r.channelKey ? (
                        <Link href={`/chat?c=${encodeURIComponent(r.channelKey)}&m=${r.messageId}`}>#{r.messageId}</Link>
                      ) : r.channelKey ? (
                        `#${r.channelKey}`
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="gcs-table__td">
                      {r.undoable && canEdit && (
                        <GcsAcpConfirmAction
                          label={t("undo")}
                          title={t("undoTitle")}
                          body={t("undoBody", { name: r.target?.name ?? "—" })}
                          confirm={t("undo")}
                          run={undoChatModLog.bind(null, r.id)}
                          testId="gcs-acp-chat-undo"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {log.pages > 1 && (
          <nav className="gcs-acpChatMod__pager" aria-label={t("pages")}>
            {log.page > 1 && (
              <Link className="gcs-btn gcs-btn--ghost gcs-btn--sm gcs-sweep" href={pageHref(log.page - 1)} rel="prev">
                {t("prev")}
              </Link>
            )}
            <span className="gcs-muted">{t("page", { page: log.page, pages: log.pages })}</span>
            {log.page < log.pages && (
              <Link className="gcs-btn gcs-btn--ghost gcs-btn--sm gcs-sweep" href={pageHref(log.page + 1)} rel="next">
                {t("next")}
              </Link>
            )}
          </nav>
        )}
      </GcsCard>
    </div>
  );
}
