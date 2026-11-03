import { faEnvelopeOpenText, faSliders } from "@fortawesome/free-solid-svg-icons";
import { CONTACT_ACP_SECTION, CONTACT_HREF, type GcsContactStatus } from "@gcs/modules";
import { GcsButton, GcsCard, GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { GcsMemberLink } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { deleteContact, replyContact, saveContactConfig, setContactStatus } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.contact"))("title") };
}

type Search = { status?: string; q?: string; page?: string; open?: string };
type Props = { searchParams: Promise<Search> };

const STATUS_LEVEL: Record<GcsContactStatus, "warn" | "off" | "ok"> = { new: "warn", read: "off", answered: "ok", archived: "off" };

/**
 * ACP › Setări › Contact: cutia mesajelor primite prin `/contact` (deschise / arhivate / toate, căutare), fiecare cu
 * panoul lui (mesajul, expeditorul, răspunsurile trimise, răspunsul pe email, citit / arhivat, ștergere) și panoul
 * „Setări” (pagina pornită, vizitatorii, textul, subiectele, notificarea staff-ului, copiile pe email, adresa externă,
 * păstrarea).
 */
export default async function AcpContactPage({ searchParams }: Props) {
  const panel = await requireAcpSection(CONTACT_ACP_SECTION);
  const sp = await searchParams;
  const { contact, acp, db } = services();
  const status = sp.status === "archived" || sp.status === "all" ? sp.status : "open";
  const [t, format, cfg, result, canEdit, canDelete] = await Promise.all([
    getTranslations("acp.contact"),
    getFormatter(),
    contact.config(),
    contact.list(panel.actor, { status, page: Number(sp.page) || 1, ...(sp.q?.trim() ? { q: sp.q.trim().slice(0, 100) } : {}) }),
    acp.can(panel.actor, CONTACT_ACP_SECTION, "edit"),
    acp.can(panel.actor, CONTACT_ACP_SECTION, "delete"),
  ]);
  const replies = await contact.replies(result.items.map((m) => m.id));
  const userIds = [...new Set([...result.items.map((m) => m.userId), ...[...replies.values()].flat().map((r) => r.actorId)].filter((id): id is string => id !== null))];
  const users = new Map((userIds.length > 0 ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u]));
  const open = Number(sp.open) || null;
  const href = (patch: Partial<Search>) => {
    const params = new URLSearchParams(Object.entries({ ...sp, open: undefined, page: undefined, ...patch }).filter(([, v]) => v) as [string, string][]);
    const qs = params.toString();
    return `/admin/settings/contact${qs ? `?${qs}` : ""}`;
  };
  const openCount = result.counts.new + result.counts.read + result.counts.answered;

  const settingsForm = (
    <GcsActionForm action={saveContactConfig} submitLabel={t("save")} submitKind="save">
      <fieldset className="gcs-formSec">
        <legend>{t("cfg.secPage")}</legend>
        <label className="gcs-toggleRow">
          <span>
            {t("cfg.enabled")}
            <small className="gcs-achHint">{t("cfg.enabledHint")}</small>
          </span>
          <input type="checkbox" name="enabled" defaultChecked={cfg.enabled} />
        </label>
        <label className="gcs-toggleRow">
          <span>
            {t("cfg.guests")}
            <small className="gcs-achHint">{t("cfg.guestsHint")}</small>
          </span>
          <input type="checkbox" name="guests" defaultChecked={cfg.guests} />
        </label>
        <label className="gcs-field">
          {t("cfg.intro")}
          <textarea className="gcs-input" name="intro" rows={3} maxLength={2000} defaultValue={cfg.intro} placeholder={t("cfg.introPlaceholder")} />
        </label>
        <label className="gcs-field">
          {t("cfg.subjects")}
          <textarea className="gcs-input" name="subjects" rows={5} defaultValue={cfg.subjects.join("\n")} />
          <span className="gcs-field__hint">{t("cfg.subjectsHint")}</span>
        </label>
        <label className="gcs-field">
          {t("cfg.redirectUrl")}
          <input className="gcs-input" name="redirectUrl" type="url" defaultValue={cfg.redirectUrl} placeholder="https://" />
          <span className="gcs-field__hint">{t("cfg.redirectHint")}</span>
        </label>
      </fieldset>
      <fieldset className="gcs-formSec">
        <legend>{t("cfg.secDelivery")}</legend>
        <label className="gcs-toggleRow">
          <span>
            {t("cfg.notifyStaff")}
            <small className="gcs-achHint">{t("cfg.notifyHint")}</small>
          </span>
          <input type="checkbox" name="notifyStaff" defaultChecked={cfg.notifyStaff} />
        </label>
        <label className="gcs-field">
          {t("cfg.emails")}
          <textarea className="gcs-input" name="emails" rows={2} defaultValue={cfg.emails.join("\n")} placeholder="admin@exemplu.ro" />
          <span className="gcs-field__hint">{t("cfg.emailsHint")}</span>
        </label>
        <label className="gcs-field">
          {t("cfg.keepDays")}
          <input className="gcs-input" name="keepDays" type="number" min={30} max={3650} defaultValue={cfg.keepDays} required />
        </label>
      </fieldset>
    </GcsActionForm>
  );

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-address-card"
        description={t("description")}
        actions={
          <>
            {cfg.enabled && (
              <GcsButton variant="ghost" asChild icon={<GcsIcon name="fa-solid fa-arrow-up-right-from-square" />}>
                <Link href={CONTACT_HREF} target="_blank" data-testid="gcs-contact-view">
                  {t("viewPage")}
                </Link>
              </GcsButton>
            )}
            {canEdit && (
              <GcsAcpEditPanel label={t("settings")} variant="primary" buttonIcon={<GcsIconSvg icon={faSliders} />} title={t("settings")} titleIcon={<GcsIconSvg icon={faSliders} />} testId="gcs-contact-settings">
                {settingsForm}
              </GcsAcpEditPanel>
            )}
          </>
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <div className="gcs-sysSummary gcs-sysSummary--ok gcs-contactSummary" data-testid="gcs-contact-summary">
        <GcsIcon name={cfg.enabled ? "fa-solid fa-circle-check" : "fa-solid fa-circle-minus"} />
        <span>
          <strong>{cfg.redirectUrl ? t("stateRedirect") : cfg.enabled ? t("stateOn") : t("stateOff")}</strong>
          <small>{cfg.redirectUrl || [cfg.guests ? t("chipGuests") : t("chipMembers"), cfg.notifyStaff ? t("chipBell") : null, cfg.emails.length > 0 ? t("chipEmails", { count: cfg.emails.length }) : null].filter(Boolean).join(" · ")}</small>
        </span>
      </div>

      <nav className="gcs-segLinks" aria-label={t("filters")} data-testid="gcs-contact-tabs">
        {(
          [
            ["open", t("tabOpen", { count: openCount }), "fa-solid fa-inbox"],
            ["archived", t("tabArchived", { count: result.counts.archived }), "fa-solid fa-box-archive"],
            ["all", t("tabAll"), "fa-solid fa-list"],
          ] as const
        ).map(([key, label, icon]) => (
          <Link key={key} href={href({ status: key === "open" ? undefined : key })} className={`gcs-segLink${status === key ? " gcs-segLink--active" : ""}`} aria-current={status === key ? "page" : undefined}>
            <GcsIcon name={icon} /> {label}
          </Link>
        ))}
      </nav>

      <GcsCard className="gcs-memberList">
        <div className="gcs-memberList__head gcs-fileHead">
          <span className="gcs-memberList__total" data-testid="gcs-contact-total">
            {t("total", { count: result.total })}
          </span>
          <form method="get" role="search" className="gcs-contactSearch">
            {status !== "open" && <input type="hidden" name="status" value={status} />}
            <input className="gcs-input" type="search" name="q" defaultValue={sp.q ?? ""} placeholder={t("search")} aria-label={t("search")} />
          </form>
        </div>
        {result.items.length === 0 ? (
          <p className="gcs-acpList__empty gcs-sysEmpty">
            <GcsIcon name="fa-solid fa-inbox" /> {t("empty")}
          </p>
        ) : (
          <ul className="gcs-sysList" data-testid="gcs-contact-list">
            {result.items.map((m) => {
              const st = m.status as GcsContactStatus;
              const sender = m.userId ? users.get(m.userId) : undefined;
              const sent = replies.get(m.id) ?? [];
              return (
                <li key={m.id} className={`gcs-sysList__row${st === "new" ? " gcs-contactRow--new" : ""}`} data-testid="gcs-contact-row" data-subject={m.subject} data-status={st}>
                  <span className="gcs-sysList__icon" aria-hidden="true">
                    <GcsIcon name={st === "answered" ? "fa-solid fa-reply" : st === "new" ? "fa-solid fa-envelope" : "fa-solid fa-envelope-open"} />
                  </span>
                  <span className="gcs-sysList__body">
                    <strong>{m.subject}</strong>
                    <small>
                      {sender ? <GcsMemberLink user={sender} href={`/admin/members/${sender.id}`} /> : m.name} · {m.email} · {format.relativeTime(m.createdAt)}
                    </small>
                    <small className="gcs-contactRow__snippet">{m.body.slice(0, 140)}</small>
                  </span>
                  <span className={`gcs-sysChip gcs-sysChip--${STATUS_LEVEL[st] ?? "off"}`}>{t(`status.${st}`)}</span>
                  <GcsAcpEditPanel
                    label={t("open")}
                    buttonIcon={<GcsIcon name="fa-solid fa-envelope-open-text" />}
                    title={m.subject}
                    titleIcon={<GcsIconSvg icon={faEnvelopeOpenText} />}
                    size="lg"
                    testId="gcs-contact-panel"
                    defaultOpen={open === m.id}
                    footer={
                      canDelete ? (
                        <GcsActionForm action={deleteContact.bind(null, m.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
                          {null}
                        </GcsActionForm>
                      ) : undefined
                    }
                  >
                    <div className="gcs-contactMsg">
                      <dl className="gcs-sysFacts">
                        <div>
                          <dt>{t("from")}</dt>
                          <dd>{sender ? <GcsMemberLink user={sender} href={`/admin/members/${sender.id}`} /> : m.name}</dd>
                        </div>
                        <div>
                          <dt>{t("email")}</dt>
                          <dd>
                            <a href={`mailto:${m.email}`}>{m.email}</a>
                          </dd>
                        </div>
                        <div>
                          <dt>{t("received")}</dt>
                          <dd>{format.dateTime(m.createdAt, { dateStyle: "medium", timeStyle: "short" })}</dd>
                        </div>
                        <div>
                          <dt>{t("ip")}</dt>
                          <dd>{m.ip ? <Link href={`/admin/members/ip-tools?ip=${encodeURIComponent(m.ip)}`}>{m.ip}</Link> : "—"}</dd>
                        </div>
                      </dl>
                      <blockquote className="gcs-contactMsg__body" data-testid="gcs-contact-body">
                        {m.body}
                      </blockquote>
                      {sent.length > 0 && (
                        <ul className="gcs-contactMsg__replies" data-testid="gcs-contact-replies">
                          {sent.map((r, i) => {
                            const who = r.actorId ? users.get(r.actorId) : undefined;
                            return (
                              <li key={i}>
                                <small>
                                  <GcsIcon name="fa-solid fa-reply" /> {who ? <GcsMemberLink user={who} href={`/admin/members/${who.id}`} /> : "—"} · {format.dateTime(r.at, { dateStyle: "medium", timeStyle: "short" })}
                                </small>
                                <p>{r.text}</p>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {canEdit && (
                        <>
                          <GcsActionForm action={replyContact.bind(null, m.id)} submitLabel={t("sendReply")} submitKind="approve" keepOpen>
                            <label className="gcs-field">
                              {t("reply")}
                              <textarea className="gcs-input" name="reply" rows={6} required minLength={2} maxLength={10000} />
                              <span className="gcs-field__hint">{t("replyHint", { email: m.email })}</span>
                            </label>
                          </GcsActionForm>
                          <div className="gcs-contactMsg__status">
                            {st === "new" && (
                              <GcsActionForm action={setContactStatus.bind(null, m.id, "read")} submitLabel={t("markRead")} submitKind="approve" variant="ghost" compact keepOpen>
                                {null}
                              </GcsActionForm>
                            )}
                            {st === "archived" ? (
                              <GcsActionForm action={setContactStatus.bind(null, m.id, "read")} submitLabel={t("unarchive")} submitKind="reset" variant="ghost" compact>
                                {null}
                              </GcsActionForm>
                            ) : (
                              <GcsActionForm action={setContactStatus.bind(null, m.id, "archived")} submitLabel={t("archive")} submitKind="close" variant="ghost" compact>
                                {null}
                              </GcsActionForm>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </GcsAcpEditPanel>
                </li>
              );
            })}
          </ul>
        )}
        {result.pages > 1 && (
          <nav className="gcs-memberList__pages" aria-label={t("pages")}>
            {result.page > 1 && (
              <GcsButton variant="ghost" size="sm" asChild>
                <Link href={href({ page: String(result.page - 1) })}>{t("prev")}</Link>
              </GcsButton>
            )}
            <span className="gcs-memberList__page">{t("page", { page: result.page, pages: result.pages })}</span>
            {result.page < result.pages && (
              <GcsButton variant="ghost" size="sm" asChild>
                <Link href={href({ page: String(result.page + 1) })}>{t("next")}</Link>
              </GcsButton>
            )}
          </nav>
        )}
      </GcsCard>
    </>
  );
}
