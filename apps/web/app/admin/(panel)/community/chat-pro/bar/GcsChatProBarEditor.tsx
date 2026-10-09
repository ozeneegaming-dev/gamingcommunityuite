"use client";

import { faArrowDown, faArrowUp, faPen, faPlus, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import type { GcsChatProBarAdminItem } from "@gcs/modules";
import { GcsButton, GcsCard, GcsIconSvg, GcsModal } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { deleteChatProBarItem, reorderChatProBar, saveChatProBarItem } from "../actions";

type Group = { id: number; key: string; name: string };

/** ISO → valoarea unui câmp `datetime-local` (ora browserului). */
function toLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Editorul barei de anunțuri (ACP): lista elementelor în ordinea afișării (mutare sus / jos, editare, ștergere cu
 * confirmare în pagină) și formularul unui element (textul, butonul cu link, programul, grupurile, pornit).
 */
export function GcsChatProBarEditor({ items, groups, canEdit, canDelete }: { items: GcsChatProBarAdminItem[]; groups: Group[]; canEdit: boolean; canDelete: boolean }) {
  const t = useTranslations("acp.chatPro.bar");
  const format = useFormatter();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [editing, setEditing] = useState<GcsChatProBarAdminItem | "new" | null>(null);
  const [confirm, setConfirm] = useState<GcsChatProBarAdminItem | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const groupName = new Map(groups.map((g) => [g.id, g.name]));

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    for (const k of ["startsAt", "endsAt"]) {
      const v = String(fd.get(k) ?? "");
      fd.set(k, v ? new Date(v).toISOString() : "");
    }
    const id = editing === "new" || editing === null ? null : editing.id;
    start(async () => {
      const res = await saveChatProBarItem(id, fd);
      if (!res.ok) return setStatus({ ok: false, text: errorMessage(res.error) });
      setStatus({ ok: true, text: t("saved") });
      setEditing(null);
      router.refresh();
    });
  };

  const move = (index: number, delta: number) => {
    const ids = items.map((i) => i.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved!);
    start(async () => {
      const res = await reorderChatProBar(ids);
      if (!res.ok) return setStatus({ ok: false, text: errorMessage(res.error) });
      router.refresh();
    });
  };

  const current = editing === "new" ? null : editing;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 900 }} data-testid="gcs-acp-chatpro-bar">
      {items.length === 0 && (
        <GcsCard style={{ padding: 16 }}>
          <p className="gcs-muted" style={{ margin: 0 }}>
            {t("empty")}
          </p>
        </GcsCard>
      )}
      {items.map((item, i) => (
        <GcsCard key={item.id} as="article" style={{ padding: 14, display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }} data-testid="gcs-acp-bar-item">
          <div style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <strong>{item.text}</strong>
            <span className="gcs-muted" style={{ fontSize: 13 }}>
              {item.ctaLabel ? `${item.ctaLabel} → ${item.ctaUrl}` : t("noButton")}
            </span>
            <span className="gcs-muted" style={{ fontSize: 12 }}>
              {item.enabled ? t("on") : t("off")} ·{" "}
              {item.startsAt || item.endsAt
                ? t("schedule", {
                    from: item.startsAt ? format.dateTime(new Date(item.startsAt), { dateStyle: "short", timeStyle: "short" }) : "—",
                    to: item.endsAt ? format.dateTime(new Date(item.endsAt), { dateStyle: "short", timeStyle: "short" }) : "—",
                  })
                : t("always")}{" "}
              · {item.groupIds.length === 0 ? t("allGroups") : item.groupIds.map((g) => groupName.get(g) ?? g).join(", ")}
            </span>
          </div>
          {canEdit && (
            <div style={{ display: "flex", gap: 4 }}>
              <GcsButton variant="ghost" size="sm" aria-label={t("up")} title={t("up")} disabled={pending || i === 0} onClick={() => move(i, -1)}>
                <GcsIconSvg icon={faArrowUp} />
              </GcsButton>
              <GcsButton variant="ghost" size="sm" aria-label={t("down")} title={t("down")} disabled={pending || i === items.length - 1} onClick={() => move(i, 1)}>
                <GcsIconSvg icon={faArrowDown} />
              </GcsButton>
              <GcsButton variant="ghost" size="sm" onClick={() => setEditing(item)}>
                <GcsIconSvg icon={faPen} /> {t("edit")}
              </GcsButton>
              {canDelete && (
                <GcsButton variant="ghost" size="sm" onClick={() => setConfirm(item)} data-testid="gcs-acp-bar-delete">
                  <GcsIconSvg icon={faTrashCan} /> {t("delete")}
                </GcsButton>
              )}
            </div>
          )}
        </GcsCard>
      ))}
      {canEdit && editing === null && (
        <div>
          <GcsButton variant="primary" onClick={() => setEditing("new")} data-testid="gcs-acp-bar-add">
            <GcsIconSvg icon={faPlus} /> {t("add")}
          </GcsButton>
        </div>
      )}
      {editing !== null && (
        <GcsCard as="section" style={{ padding: 16 }} aria-label={current ? t("edit") : t("add")}>
          <form key={current?.id ?? "new"} onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-acp-bar-form">
            <label className="gcs-field">
              {t("text")}
              <input className="gcs-input" name="text" defaultValue={current?.text ?? ""} maxLength={200} required />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <label className="gcs-field">
                {t("ctaLabel")}
                <input className="gcs-input" name="ctaLabel" defaultValue={current?.ctaLabel ?? ""} maxLength={40} />
              </label>
              <label className="gcs-field">
                {t("ctaUrl")}
                <input className="gcs-input" name="ctaUrl" defaultValue={current?.ctaUrl ?? ""} maxLength={300} placeholder="https://… / /servers" />
              </label>
              <label className="gcs-field">
                {t("startsAt")}
                <input className="gcs-input" type="datetime-local" name="startsAt" defaultValue={toLocal(current?.startsAt ?? null)} />
              </label>
              <label className="gcs-field">
                {t("endsAt")}
                <input className="gcs-input" type="datetime-local" name="endsAt" defaultValue={toLocal(current?.endsAt ?? null)} />
              </label>
            </div>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="gcs-muted" style={{ fontSize: 13, marginBottom: 6 }}>
                {t("groups")}
              </legend>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
                {groups.map((g) => (
                  <label key={g.id} className="gcs-check">
                    <input type="checkbox" name="groups" value={g.id} defaultChecked={current?.groupIds.includes(g.id) ?? false} />
                    <span className={`gcs-name--${g.key}`}>{g.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="gcs-check">
              <input type="checkbox" role="switch" className="gcs-chat__switch" name="enabled" defaultChecked={current?.enabled ?? true} />
              {t("enabled")}
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <GcsButton type="submit" variant="primary" disabled={pending} data-testid="gcs-acp-bar-save">
                {t("save")}
              </GcsButton>
              <GcsButton type="button" variant="ghost" onClick={() => setEditing(null)}>
                {t("cancel")}
              </GcsButton>
            </div>
          </form>
        </GcsCard>
      )}
      {status && (
        <p role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-muted" : "gcs-notice gcs-notice--error"} style={{ margin: 0 }}>
          {status.text}
        </p>
      )}
      {confirm && (
        <GcsModal title={t("confirmTitle")} onClose={() => setConfirm(null)} closeLabel={t("cancel")} size="sm">
          <p style={{ marginTop: 0 }}>{t("confirmText", { text: confirm.text })}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <GcsButton
              variant="primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await deleteChatProBarItem(confirm.id);
                  setConfirm(null);
                  if (!res.ok) return setStatus({ ok: false, text: errorMessage(res.error) });
                  router.refresh();
                })
              }
              data-testid="gcs-acp-bar-confirm"
            >
              {t("delete")}
            </GcsButton>
            <GcsButton variant="ghost" onClick={() => setConfirm(null)}>
              {t("cancel")}
            </GcsButton>
          </div>
        </GcsModal>
      )}
    </div>
  );
}
