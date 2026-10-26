import { SHIPPED_PHISHING_DOMAINS } from "@gcs/core";
import { ANTISPAM_ACP_SECTION, SPAM_LOG_KINDS } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { deleteQuestionAction, saveCaptchaAction, saveNewMembersAction, savePhishingAction, saveQuestionAction, saveSpamSourceAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.antispam"))("title") };
}

const card = { padding: 20, display: "flex", flexDirection: "column", gap: 12 } as const;
const muted = { margin: 0, color: "var(--gcs-muted)", fontSize: 13 } as const;
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 } as const;
const row = { display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", borderTop: "1px solid var(--gcs-border)", paddingTop: 10 } as const;
const LOCALES = ["ro", "en", "de", "es", "fr", "ru"] as const;

/**
 * ACP › Moderare › Anti-spam: statisticile și jurnalul apărării, captcha-ul de la înregistrare (proof-of-work propriu,
 * Turnstile sau deloc), întrebările, restricțiile membrilor noi, lista de phishing și lista publică de spammeri.
 * „Marchează ca spammer” e pe fișa membrului.
 */
export default async function AcpAntispamPage({ searchParams }: { searchParams: Promise<{ kind?: string; q?: string; page?: string }> }) {
  const { actor } = await requireAcpSection(ANTISPAM_ACP_SECTION);
  const sp = await searchParams;
  const t = await getTranslations("acp.antispam");
  const format = await getFormatter();
  const { antispam, settings } = services();
  const get = <T,>(key: string) => settings.get<T>(key);
  const [stats, log, questions, s] = await Promise.all([
    antispam.stats(actor, 30),
    antispam.logs(actor, { ...(sp.kind ? { kind: sp.kind } : {}), ...(sp.q ? { q: sp.q } : {}), page: Number(sp.page) || 1 }),
    antispam.questions(actor),
    Promise.all([
      get<string>("antispam.captcha"),
      get<number>("antispam.pow_difficulty"),
      get<boolean>("antispam.qa_enabled"),
      get<number>("antispam.new_member_days"),
      get<number>("antispam.new_member_posts"),
      get<string>("antispam.new_member_links"),
      get<number>("antispam.new_member_images"),
      get<number>("antispam.new_member_pms_per_day"),
      get<boolean>("antispam.new_member_approval"),
      get<number>("antispam.new_member_chat_slow"),
      get<boolean>("antispam.phishing_enabled"),
      get<string>("antispam.phishing_domains"),
      get<string>("antispam.phishing_allow"),
      get<boolean>("antispam.sfs_enabled"),
      get<string>("antispam.sfs_api_key"),
      get<number>("antispam.sfs_confidence"),
    ]),
  ]);
  const [captcha, difficulty, qa, days, posts, links, images, pms, approval, chatSlow, phishing, blocked, allowed, sfs, sfsKey, confidence] = s;
  const page = (n: number) => `?${new URLSearchParams({ ...(sp.kind ? { kind: sp.kind } : {}), ...(sp.q ? { q: sp.q } : {}), page: String(n) })}`;
  const maxDay = Math.max(1, ...stats.perDay.map((d) => d.count));

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-shield-virus">{t("title")}</GcsAcpTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1040 }}>
        <GcsCard style={card} data-testid="gcs-antispam-stats">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("stats.title", { count: stats.total })}</h2>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 60 }} aria-hidden="true">
            {stats.perDay.map((d) => (
              <span key={d.day} title={`${d.day}: ${d.count}`} style={{ flex: 1, minWidth: 3, height: `${Math.max(4, (d.count / maxDay) * 100)}%`, background: d.count ? "var(--gcs-accent)" : "var(--gcs-border)", borderRadius: 2 }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {SPAM_LOG_KINDS.map((k) => (
              <Link key={k} href={`?kind=${k}`} className="gcs-badge gcs-badge--neutral" data-testid={`gcs-antispam-stat-${k}`}>
                {t(`kinds.${k}`)}: {stats.byKind[k] ?? 0}
              </Link>
            ))}
          </div>
        </GcsCard>

        <GcsCard style={card} data-testid="gcs-antispam-log">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("log.title")}</h2>
          <form method="get" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="gcs-field">
              {t("log.kind")}
              <select className="gcs-input" name="kind" defaultValue={sp.kind ?? ""}>
                <option value="">{t("log.anyKind")}</option>
                {SPAM_LOG_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="gcs-field">
              {t("log.search")}
              <input className="gcs-input" name="q" defaultValue={sp.q ?? ""} maxLength={200} />
            </label>
            <button type="submit" className="gcs-btn gcs-btn--ghost">
              {t("log.filter")}
            </button>
          </form>
          {log.rows.length === 0 && <p style={muted}>{t("log.empty")}</p>}
          {log.rows.length > 0 && (
            <div className="gcs-table">
              <table className="gcs-table__table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>{t("log.when")}</th>
                    <th>{t("log.kind")}</th>
                    <th>{t("log.who")}</th>
                    <th>IP</th>
                    <th>{t("log.detail")}</th>
                  </tr>
                </thead>
                <tbody>
                  {log.rows.map((r) => (
                    <tr key={r.id} data-testid="gcs-antispam-log-row" data-kind={r.kind}>
                      <td>{format.dateTime(r.createdAt, { dateStyle: "short", timeStyle: "short" })}</td>
                      <td>{(SPAM_LOG_KINDS as readonly string[]).includes(r.kind) ? t(`kinds.${r.kind}`) : r.kind}</td>
                      <td>{r.user ? <Link href={`/admin/members/${r.user.id}`}>{r.user.name}</Link> : (r.email ?? "—")}</td>
                      <td>{r.ip ? <Link href={`/admin/members/ip-tools?ip=${encodeURIComponent(r.ip)}`}>{r.ip}</Link> : "—"}</td>
                      <td style={{ fontFamily: "var(--gcs-font-mono, monospace)", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.detail ? JSON.stringify(r.detail) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {log.pages > 1 && (
            <p style={{ ...muted, display: "flex", gap: 12 }}>
              {log.page > 1 && <Link href={page(log.page - 1)}>{t("log.prev")}</Link>}
              <span>{t("log.page", { page: log.page, pages: log.pages })}</span>
              {log.page < log.pages && <Link href={page(log.page + 1)}>{t("log.next")}</Link>}
            </p>
          )}
        </GcsCard>

        <GcsCard style={card} data-testid="gcs-antispam-captcha">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("captcha.title")}</h2>
          <p style={muted}>{t("captcha.body")}</p>
          <GcsActionForm action={saveCaptchaAction} submitLabel={t("save")} submitKind="save">
            <div style={grid}>
              <label className="gcs-field">
                {t("captcha.mode")}
                <select className="gcs-input" name="captcha" defaultValue={captcha}>
                  {(["pow", "turnstile", "none"] as const).map((m) => (
                    <option key={m} value={m}>
                      {t(`captcha.modes.${m}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gcs-field">
                {t("captcha.difficulty")}
                <input className="gcs-input" name="difficulty" type="number" min={8} max={24} defaultValue={difficulty} required />
              </label>
            </div>
            <p style={muted}>{t("captcha.turnstileHint")}</p>
            <label className="gcs-check">
              <input type="checkbox" name="qa" defaultChecked={qa} /> {t("captcha.qa")}
            </label>
          </GcsActionForm>
        </GcsCard>

        <GcsCard style={card} data-testid="gcs-antispam-questions">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("questions.title")}</h2>
          <p style={muted}>{t("questions.body")}</p>
          {[...questions, null].map((q) => (
            <div key={q?.id ?? "new"} style={row} data-testid={q ? "gcs-antispam-question" : "gcs-antispam-question-new"}>
              <GcsActionForm action={saveQuestionAction.bind(null, q?.id ?? null)} submitLabel={q ? t("save") : t("questions.add")} submitKind={q ? "save" : "create"}>
                <div style={grid}>
                  <label className="gcs-field">
                    {t("questions.question")}
                    <input className="gcs-input" name="question" defaultValue={q?.question ?? ""} required minLength={3} maxLength={300} />
                  </label>
                  <label className="gcs-field">
                    {t("questions.locale")}
                    <select className="gcs-input" name="locale" defaultValue={q?.locale ?? ""}>
                      <option value="">{t("questions.allLocales")}</option>
                      {LOCALES.map((l) => (
                        <option key={l} value={l}>
                          {l.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="gcs-field">
                  {t("questions.answers")}
                  <textarea className="gcs-input" name="answers" rows={3} defaultValue={Array.isArray(q?.answers) ? (q.answers as string[]).join("\n") : ""} required />
                </label>
                <label className="gcs-check">
                  <input type="checkbox" name="enabled" defaultChecked={q?.enabled ?? true} /> {t("questions.enabled")}
                </label>
              </GcsActionForm>
              {q && <GcsActionForm action={deleteQuestionAction.bind(null, q.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("questions.deleteConfirm")} />}
            </div>
          ))}
        </GcsCard>

        <GcsCard style={card} data-testid="gcs-antispam-newmembers">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("newMembers.title")}</h2>
          <p style={muted}>{t("newMembers.body")}</p>
          <GcsActionForm action={saveNewMembersAction} submitLabel={t("save")} submitKind="save">
            <div style={grid}>
              <label className="gcs-field">
                {t("newMembers.days")}
                <input className="gcs-input" name="days" type="number" min={0} max={365} defaultValue={days} required />
              </label>
              <label className="gcs-field">
                {t("newMembers.posts")}
                <input className="gcs-input" name="posts" type="number" min={0} max={1000} defaultValue={posts} required />
              </label>
              <label className="gcs-field">
                {t("newMembers.links")}
                <select className="gcs-input" name="links" defaultValue={links}>
                  {(["moderate", "block", "allow"] as const).map((m) => (
                    <option key={m} value={m}>
                      {t(`newMembers.linkModes.${m}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gcs-field">
                {t("newMembers.images")}
                <input className="gcs-input" name="images" type="number" min={0} max={50} defaultValue={images} required />
              </label>
              <label className="gcs-field">
                {t("newMembers.pms")}
                <input className="gcs-input" name="pms" type="number" min={0} max={1000} defaultValue={pms} required />
              </label>
              <label className="gcs-field">
                {t("newMembers.chatSlow")}
                <input className="gcs-input" name="chatSlow" type="number" min={0} max={600} defaultValue={chatSlow} required />
              </label>
            </div>
            <label className="gcs-check">
              <input type="checkbox" name="approval" defaultChecked={approval} /> {t("newMembers.approval")}
            </label>
          </GcsActionForm>
        </GcsCard>

        <GcsCard style={card} data-testid="gcs-antispam-phishing">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("phishing.title")}</h2>
          <p style={muted}>{t("phishing.body", { count: SHIPPED_PHISHING_DOMAINS.length })}</p>
          <GcsActionForm action={savePhishingAction} submitLabel={t("save")} submitKind="save">
            <label className="gcs-check">
              <input type="checkbox" name="enabled" defaultChecked={phishing} /> {t("phishing.enabled")}
            </label>
            <div style={grid}>
              <label className="gcs-field">
                {t("phishing.blocked")}
                <textarea className="gcs-input" name="blocked" rows={5} defaultValue={blocked} placeholder="steam-gift-example.com" />
              </label>
              <label className="gcs-field">
                {t("phishing.allowed")}
                <textarea className="gcs-input" name="allowed" rows={5} defaultValue={allowed} />
              </label>
            </div>
          </GcsActionForm>
        </GcsCard>

        <GcsCard style={card} data-testid="gcs-antispam-sfs">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("sfs.title")}</h2>
          <p style={muted}>{t("sfs.body")}</p>
          <GcsActionForm action={saveSpamSourceAction} submitLabel={t("save")} submitKind="save">
            <label className="gcs-check">
              <input type="checkbox" name="enabled" defaultChecked={sfs} /> {t("sfs.enabled")}
            </label>
            <div style={grid}>
              <label className="gcs-field">
                {t("sfs.confidence")}
                <input className="gcs-input" name="confidence" type="number" min={1} max={100} defaultValue={confidence} required />
              </label>
              <label className="gcs-field">
                {t("sfs.apiKey")}
                <input className="gcs-input" name="apiKey" type="password" autoComplete="off" placeholder={sfsKey ? t("sfs.keySet") : t("sfs.keyEmpty")} />
              </label>
            </div>
            {sfsKey && (
              <label className="gcs-check">
                <input type="checkbox" name="clearKey" /> {t("sfs.clearKey")}
              </label>
            )}
          </GcsActionForm>
        </GcsCard>
      </div>
    </>
  );
}
