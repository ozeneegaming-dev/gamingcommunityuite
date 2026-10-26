import { GcsValidationError, normalizeUsername } from "@gcs/core";
import { IP_RETENTION_SETTING, IP_TOOLS_ACP_SECTION, type GcsIpLookup, type GcsMemberIp } from "@gcs/modules";
import { GcsBadge, GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { saveIpRetentionAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.ipTools"))("title") };
}

const card = { padding: 20, display: "flex", flexDirection: "column", gap: 12 } as const;
const muted = { margin: 0, color: "var(--gcs-muted)", fontSize: 13 } as const;
const form = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" } as const;

/**
 * ACP › Membri › Unelte IP: căutarea după IP (sau prefix cu `*`) — conturi, postări, mesaje, sesiuni; IP-urile unui
 * membru; IP-urile comune mai multor conturi din ultimele 30 de zile; păstrarea IP-urilor (GDPR).
 */
export default async function AcpIpToolsPage({ searchParams }: { searchParams: Promise<{ ip?: string; member?: string }> }) {
  const { actor } = await requireAcpSection(IP_TOOLS_ACP_SECTION);
  const sp = await searchParams;
  const t = await getTranslations("acp.ipTools");
  const format = await getFormatter();
  const { ipTools, db, settings } = services();
  const date = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "medium", timeStyle: "short" }) : "—");

  let ipResult: GcsIpLookup | null = null;
  let ipError = false;
  if (sp.ip?.trim()) {
    try {
      ipResult = await ipTools.lookupIp(actor, sp.ip);
    } catch (error) {
      if (!(error instanceof GcsValidationError)) throw error;
      ipError = true;
    }
  }
  const memberQuery = sp.member?.trim() ?? "";
  const member = memberQuery
    ? await db.user.findFirst({ where: { OR: [{ id: memberQuery }, { nameNormalized: normalizeUsername(memberQuery) }] }, select: { id: true, name: true } })
    : null;
  const [memberIps, shared, retention] = await Promise.all([
    member ? ipTools.memberIps(actor, member.id) : Promise.resolve<GcsMemberIp[]>([]),
    ipTools.sharedIps(actor),
    settings.get<number>(IP_RETENTION_SETTING),
  ]);
  const sources = (list: string[]) => list.map((s) => t(`sources.${s}`)).join(", ");

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-network-wired">{t("title")}</GcsAcpTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1040 }}>
        <GcsCard style={card} data-testid="gcs-iptools-ip">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("ip.title")}</h2>
          <form method="get" style={form}>
            <label className="gcs-field">
              {t("ip.label")}
              <input className="gcs-input" name="ip" defaultValue={sp.ip ?? ""} placeholder="203.0.113.7 / 203.0.113.*" maxLength={64} data-testid="gcs-iptools-ip-input" />
            </label>
            <button type="submit" className="gcs-btn gcs-btn--primary">
              {t("search")}
            </button>
          </form>
          {ipError && (
            <p role="alert" className="gcs-notice gcs-notice--error" style={{ margin: 0 }}>
              {t("ip.invalid")}
            </p>
          )}
          {ipResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-iptools-ip-result">
              <p style={muted}>
                {t("ip.counts", ipResult.counts)}
                {ipResult.ban && (
                  <>
                    {" · "}
                    <GcsBadge tone="accent">{t("ip.banned", { reason: ipResult.ban.reason })}</GcsBadge>
                  </>
                )}
              </p>
              {ipResult.accounts.length === 0 && <p style={muted}>{t("ip.noAccounts")}</p>}
              {ipResult.accounts.map((a) => (
                <div key={a.id} className="gcs-memberRow" data-testid="gcs-iptools-account">
                  <span>
                    <Link href={`/admin/members/${a.id}`}>{a.name}</Link> <span className="gcs-mdCard__muted">· {sources(a.sources)}</span>
                  </span>
                  <span className="gcs-memberRow__end">
                    {a.isSpammer && <GcsBadge tone="accent">{t("spammer")}</GcsBadge>}
                    {a.banned && <GcsBadge tone="warn">{t("banned")}</GcsBadge>}
                    <span className="gcs-mdCard__muted">{date(a.lastSeen)}</span>
                    <Link href={`?member=${encodeURIComponent(a.id)}`}>{t("ip.memberIps")}</Link>
                  </span>
                </div>
              ))}
              {ipResult.posts.length > 0 && (
                <>
                  <h3 style={{ margin: "6px 0 0", fontSize: 14 }}>{t("ip.posts")}</h3>
                  {ipResult.posts.map((p) => (
                    <div key={p.id} className="gcs-memberRow">
                      <span>
                        <Link href={`/topic/${p.topicId}/post/${p.id}`}>{p.title}</Link> <span className="gcs-mdCard__muted">· {p.authorName ?? "—"}</span>
                      </span>
                      <span className="gcs-memberRow__end gcs-mdCard__muted">{date(p.createdAt)}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </GcsCard>

        <GcsCard style={card} data-testid="gcs-iptools-member">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("member.title")}</h2>
          <form method="get" style={form}>
            <label className="gcs-field">
              {t("member.label")}
              <input className="gcs-input" name="member" defaultValue={member?.name ?? memberQuery} maxLength={64} data-testid="gcs-iptools-member-input" />
            </label>
            <button type="submit" className="gcs-btn gcs-btn--primary">
              {t("search")}
            </button>
          </form>
          {memberQuery && !member && <p style={muted}>{t("member.notFound")}</p>}
          {member && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="gcs-iptools-member-result">
              <p style={{ margin: 0 }}>
                <Link href={`/admin/members/${member.id}`}>{member.name}</Link>
              </p>
              {memberIps.length === 0 && <p style={muted}>{t("member.noIps")}</p>}
              {memberIps.map((r) => (
                <div key={r.ip} className="gcs-memberRow" data-testid="gcs-iptools-member-ip">
                  <span>
                    <Link href={`?ip=${encodeURIComponent(r.ip)}`}>{r.ip}</Link> <span className="gcs-mdCard__muted">· {sources(r.sources)}</span>
                  </span>
                  <span className="gcs-memberRow__end">
                    {r.others > 0 && <GcsBadge tone="warn">{t("member.others", { count: r.others })}</GcsBadge>}
                    <span className="gcs-mdCard__muted">{date(r.lastSeen)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </GcsCard>

        <GcsCard style={card} data-testid="gcs-iptools-shared">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("shared.title")}</h2>
          <p style={muted}>{t("shared.body")}</p>
          {shared.length === 0 && <p style={muted}>{t("shared.empty")}</p>}
          {shared.map((s) => (
            <div key={s.ip} className="gcs-memberRow" data-testid="gcs-iptools-shared-row">
              <span>
                <Link href={`?ip=${encodeURIComponent(s.ip)}`}>{s.ip}</Link>{" "}
                <span className="gcs-mdCard__muted">
                  ·{" "}
                  {s.users.map((u, i) => (
                    <span key={u.id}>
                      {i > 0 && ", "}
                      <Link href={`/admin/members/${u.id}`} style={u.banned || u.isSpammer ? { textDecoration: "line-through" } : undefined}>
                        {u.name}
                      </Link>
                    </span>
                  ))}
                </span>
              </span>
              <span className="gcs-memberRow__end gcs-mdCard__muted">{date(s.lastSeen)}</span>
            </div>
          ))}
        </GcsCard>

        <GcsCard style={card} data-testid="gcs-iptools-retention">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("retention.title")}</h2>
          <p style={muted}>{t("retention.body")}</p>
          <GcsActionForm action={saveIpRetentionAction} submitLabel={t("save")} submitKind="save">
            <label className="gcs-field">
              {t("retention.days")}
              <input className="gcs-input" name="days" type="number" min={0} max={3650} defaultValue={retention} required style={{ maxWidth: 200 }} />
            </label>
          </GcsActionForm>
        </GcsCard>
      </div>
    </>
  );
}
