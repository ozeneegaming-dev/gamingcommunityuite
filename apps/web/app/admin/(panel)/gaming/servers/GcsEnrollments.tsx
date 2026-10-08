"use client";

import { faBan, faCheck, faRotate, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { GcsEnrollmentView } from "@gcs/modules";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { approveEnrollment, blockEnrollmentIp, recheckEnrollment, rejectEnrollment } from "./enroll-actions";

export type GcsEnrollmentItem = GcsEnrollmentView & {
  /** Datele formatate pe server (fusul orar și limba adminului). */
  firstSeenLabel: string;
  lastSeenLabel: string;
  gameName: string;
};

type Props = { items: GcsEnrollmentItem[]; servers: { id: number; name: string; game: string }[]; canEdit: boolean };

const CHECK_BADGE: Record<string, string> = { ok: "gcs-badge--ok", game_mismatch: "gcs-badge--warn", offline: "gcs-badge--warn", blocked: "gcs-badge--neutral" };

/**
 * „Servere noi detectate” (specul 2026-10-08-servere-plugin-v2 §5.4): serverele cu pluginul general care cer o cheie.
 * Datele raportate (numele, harta) vin de la server și se arată doar ca text. Aprobarea creează un server nou sau îl
 * atașează la unul existent; fără interogarea confirmată cere confirmarea explicită.
 */
export function GcsEnrollments({ items, servers, canEdit }: Props) {
  const t = useTranslations("acp.servers.enroll");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, setPending] = useState<number | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [targets, setTargets] = useState<Record<number, string>>(() => Object.fromEntries(items.map((i) => [i.id, i.sameAddress ? String(i.sameAddress.id) : ""])));

  async function run<T>(id: number, fn: () => Promise<{ ok: true; data: T } | { ok: false; error: Parameters<typeof errorMessage>[0] }>, done: (data: T) => string) {
    setPending(id);
    setStatus(null);
    const res = await fn();
    setPending(null);
    if (!res.ok) return setStatus({ ok: false, text: errorMessage(res.error) });
    setStatus({ ok: true, text: done(res.data) });
    router.refresh();
  }

  function approve(item: GcsEnrollmentItem) {
    const verified = item.check?.result === "ok";
    if (!verified && !window.confirm(t("approveUnverified"))) return;
    const target = targets[item.id] ?? "";
    void run(item.id, () => approveEnrollment(item.id, { serverId: target ? Number(target) : null, force: !verified }), (d) => (d.created ? t("approvedNew") : t("approvedAttached")));
  }

  if (items.length === 0) {
    return (
      <p className="gcs-muted" style={{ margin: 0 }} data-testid="gcs-enroll-empty">
        {t("empty")}
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {status && (
        <span role={status.ok ? "status" : "alert"} style={{ fontWeight: 600, fontSize: 13, color: status.ok ? "var(--gcs-ok)" : "#FF8A91" }}>
          {status.text}
        </span>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="gcs-table__table" data-testid="gcs-enrollments">
          <thead>
            <tr>
              <th className="gcs-table__th" scope="col">{t("address")}</th>
              <th className="gcs-table__th" scope="col">{t("server")}</th>
              <th className="gcs-table__th" scope="col">{t("check")}</th>
              <th className="gcs-table__th" scope="col">{t("seen")}</th>
              <th className="gcs-table__th" scope="col">{t("decision")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const sameGame = servers.filter((s) => s.game === item.game);
              const busy = pending === item.id;
              return (
                <tr key={item.id} className="gcs-table__row" data-testid="gcs-enrollment" data-status={item.status} data-address={`${item.ip}:${item.port}`}>
                  <td className="gcs-table__td">
                    <code>{item.ip.includes(":") ? `[${item.ip}]:${item.port}` : `${item.ip}:${item.port}`}</code>
                    <div className="gcs-muted" style={{ fontSize: 12 }}>
                      {item.gameName} · {item.plugin || "—"}
                    </div>
                    {item.duplicate && (
                      <span className="gcs-badge gcs-badge--warn" title={t("duplicateHint")}>
                        {t("duplicate")}
                      </span>
                    )}
                  </td>
                  <td className="gcs-table__td">
                    <strong>{item.hostname || "—"}</strong>
                    <div className="gcs-muted" style={{ fontSize: 12 }}>
                      {t("mapPlayers", { map: item.map ?? "—", players: item.players, max: item.maxPlayers })}
                    </div>
                  </td>
                  <td className="gcs-table__td">
                    <span className={`gcs-badge ${CHECK_BADGE[item.check?.result ?? ""] ?? "gcs-badge--neutral"}`} data-testid="gcs-enrollment-check" data-result={item.check?.result ?? "none"}>
                      {t(`checks.${item.check?.result ?? "none"}`)}
                    </span>
                    {item.check?.result === "ok" && (
                      <div className="gcs-muted" style={{ fontSize: 12 }}>
                        {item.check.name ?? "—"} · {item.check.map ?? "—"}
                        {(!item.check.nameMatch || !item.check.mapMatch) && ` · ${t("differs")}`}
                      </div>
                    )}
                    {item.status === "PENDING" && canEdit && (
                      <div style={{ marginTop: 4 }}>
                        <GcsButton size="sm" variant="ghost" type="button" disabled={busy} icon={<GcsIconSvg icon={faRotate} />} onClick={() => void run(item.id, () => recheckEnrollment(item.id), () => t("rechecked"))}>
                          {t("recheck")}
                        </GcsButton>
                      </div>
                    )}
                  </td>
                  <td className="gcs-table__td" style={{ fontSize: 13 }}>
                    {t("firstSeen", { time: item.firstSeenLabel })}
                    <div className="gcs-muted">{t("lastSeen", { time: item.lastSeenLabel })}</div>
                  </td>
                  <td className="gcs-table__td">
                    {item.status !== "PENDING" ? (
                      <span className={`gcs-badge ${item.status === "APPROVED" ? "gcs-badge--ok" : "gcs-badge--neutral"}`}>
                        {item.status === "APPROVED" ? (item.delivered ? t("approvedDelivered", { server: item.server?.name ?? "—" }) : t("approvedWaiting", { server: item.server?.name ?? "—" })) : t("rejected")}
                      </span>
                    ) : canEdit ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 220 }}>
                        <select className="gcs-input" value={targets[item.id] ?? ""} onChange={(e) => setTargets({ ...targets, [item.id]: e.target.value })} aria-label={t("target")} data-testid="gcs-enrollment-target">
                          <option value="">{t("newServer")}</option>
                          {sameGame.map((s) => (
                            <option key={s.id} value={s.id}>
                              {t("attachTo", { name: s.name })}
                            </option>
                          ))}
                        </select>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <GcsButton size="sm" variant="primary" type="button" disabled={busy} icon={<GcsIconSvg icon={faCheck} />} onClick={() => approve(item)} data-testid="gcs-enrollment-approve">
                            {item.check?.result === "ok" ? t("approve") : t("approveAnyway")}
                          </GcsButton>
                          <GcsButton size="sm" variant="ghost" type="button" disabled={busy} icon={<GcsIconSvg icon={faXmark} />} onClick={() => void run(item.id, () => rejectEnrollment(item.id), () => t("rejectedDone"))} data-testid="gcs-enrollment-reject">
                            {t("reject")}
                          </GcsButton>
                          <GcsButton
                            size="sm"
                            variant="ghost"
                            type="button"
                            disabled={busy}
                            icon={<GcsIconSvg icon={faBan} />}
                            onClick={() => window.confirm(t("blockConfirm", { ip: item.ip })) && void run(item.id, () => blockEnrollmentIp(item.id), (d) => t("blocked", { count: d.rejected }))}
                            data-testid="gcs-enrollment-block"
                          >
                            {t("block")}
                          </GcsButton>
                        </div>
                      </div>
                    ) : (
                      <span className="gcs-badge">{t("pending")}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
