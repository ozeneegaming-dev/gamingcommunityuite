import { WARNINGS_ACK_SETTING, WARNINGS_ACP_SECTION } from "@gcs/core";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import {
  decideAppealAction,
  deleteWarningReasonAction,
  deleteWarningThresholdAction,
  saveWarningReasonAction,
  saveWarningSettingsAction,
  saveWarningThresholdAction,
} from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.warnings"))("title") };
}

const card = { padding: 20, display: "flex", flexDirection: "column", gap: 12 } as const;
const muted = { margin: 0, color: "var(--gcs-muted)", fontSize: 13 } as const;
const row = { display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", borderTop: "1px solid var(--gcs-border)", paddingTop: 10 } as const;
const ACTIONS = ["MODERATE_POSTS", "RESTRICT", "BAN"] as const;

/**
 * ACP › Moderare › Avertismente: contestațiile în așteptare (acceptate = avertismentul anulat), confirmarea obligatorie,
 * motivele predefinite (puncte și expirare implicite) și pragurile (postări moderate, restricție, ban) cu durata lor.
 * Avertismentele se dau din fișa membrului (ACP) sau din chat.
 */
export default async function AcpWarningsPage() {
  const { actor } = await requireAcpSection(WARNINGS_ACP_SECTION);
  const t = await getTranslations("acp.warnings");
  const format = await getFormatter();
  const { warnings, settings } = services();
  const [appeals, reasons, thresholds, ack] = await Promise.all([warnings.appeals(actor), warnings.reasons(), warnings.thresholds(), settings.get<boolean>(WARNINGS_ACK_SETTING)]);

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-triangle-exclamation">{t("title")}</GcsAcpTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 960 }}>
        <GcsCard style={card} data-testid="gcs-warnings-appeals">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("appeals.title", { count: appeals.length })}</h2>
          {appeals.length === 0 && <p style={muted}>{t("appeals.empty")}</p>}
          {appeals.map((a) => (
            <div key={a.id} style={{ ...row, flexDirection: "column", alignItems: "stretch" }} data-testid="gcs-warnings-appeal">
              <p style={{ margin: 0 }}>
                <strong>{a.user ? <Link href={`/admin/members/${a.user.id}`}>{a.user.name}</Link> : "—"}</strong> · {t("appeals.warning", { points: a.warning.points, reason: a.warning.reason })}
              </p>
              <p style={muted}>{format.dateTime(a.createdAt, { dateStyle: "medium", timeStyle: "short" })}</p>
              <blockquote style={{ margin: 0, padding: "8px 12px", borderLeft: "3px solid var(--gcs-border)", whiteSpace: "pre-wrap" }}>{a.text}</blockquote>
              <GcsActionForm action={decideAppealAction.bind(null, a.id)} submitLabel={t("appeals.decide")} submitKind="save">
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <label className="gcs-check">
                    <input type="radio" name="decision" value="accept" required /> {t("appeals.accept")}
                  </label>
                  <label className="gcs-check">
                    <input type="radio" name="decision" value="reject" /> {t("appeals.reject")}
                  </label>
                </div>
                <label className="gcs-field">
                  {t("appeals.reason")}
                  <input className="gcs-input" name="reason" maxLength={1000} />
                </label>
              </GcsActionForm>
            </div>
          ))}
        </GcsCard>

        <GcsCard style={card} data-testid="gcs-warnings-settings">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("settings.title")}</h2>
          <GcsActionForm action={saveWarningSettingsAction} submitLabel={t("save")} submitKind="save">
            <label className="gcs-check">
              <input type="checkbox" name="ack" defaultChecked={ack !== false} /> {t("settings.ack")}
            </label>
            <p style={muted}>{t("settings.ackHint")}</p>
          </GcsActionForm>
        </GcsCard>

        <GcsCard style={card} data-testid="gcs-warnings-reasons">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("reasons.title")}</h2>
          <p style={muted}>{t("reasons.body")}</p>
          {[...reasons, null].map((r) => (
            <div key={r?.id ?? "new"} style={row}>
              <GcsActionForm action={saveWarningReasonAction.bind(null, r?.id ?? null)} submitLabel={r ? t("save") : t("reasons.add")} submitKind={r ? "save" : "create"} compact>
                <input className="gcs-input" name="name" defaultValue={r?.name ?? ""} placeholder={t("reasons.name")} aria-label={t("reasons.name")} required maxLength={120} />
                <input className="gcs-input" name="points" type="number" min={1} max={100} defaultValue={r?.points ?? 1} aria-label={t("reasons.points")} style={{ width: 90 }} required />
                <input className="gcs-input" name="expiresDays" type="number" min={0} max={3650} defaultValue={r?.expiresDays ?? ""} placeholder={t("reasons.expiresDays")} aria-label={t("reasons.expiresDays")} style={{ width: 150 }} />
              </GcsActionForm>
              {r && <GcsActionForm action={deleteWarningReasonAction.bind(null, r.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("reasons.deleteConfirm")} />}
            </div>
          ))}
        </GcsCard>

        <GcsCard style={card} data-testid="gcs-warnings-thresholds">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("thresholds.title")}</h2>
          <p style={muted}>{t("thresholds.body")}</p>
          {[...thresholds, null].map((th) => (
            <div key={th?.id ?? "new"} style={row}>
              <GcsActionForm action={saveWarningThresholdAction.bind(null, th?.id ?? null)} submitLabel={th ? t("save") : t("thresholds.add")} submitKind={th ? "save" : "create"} compact>
                <input className="gcs-input" name="threshold" type="number" min={1} max={1000} defaultValue={th?.threshold ?? ""} placeholder={t("thresholds.points")} aria-label={t("thresholds.points")} style={{ width: 110 }} required />
                <select className="gcs-input" name="action" defaultValue={th?.action ?? "MODERATE_POSTS"} aria-label={t("thresholds.action")}>
                  {ACTIONS.map((a) => (
                    <option key={a} value={a}>
                      {t(`thresholds.actions.${a}`)}
                    </option>
                  ))}
                </select>
                <input className="gcs-input" name="durationHours" type="number" min={0} max={87600} defaultValue={th?.durationHours ?? ""} placeholder={t("thresholds.hours")} aria-label={t("thresholds.hours")} style={{ width: 160 }} />
              </GcsActionForm>
              {th && <GcsActionForm action={deleteWarningThresholdAction.bind(null, th.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("thresholds.deleteConfirm")} />}
            </div>
          ))}
        </GcsCard>
      </div>
    </>
  );
}
