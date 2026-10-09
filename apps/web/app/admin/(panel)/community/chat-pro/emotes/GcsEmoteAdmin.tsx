"use client";

import { faCloudArrowUp, faPen, faPlus, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import type { GcsResult } from "@gcs/core";
import type { GcsChatEmoteView } from "@gcs/modules";
import { GcsButton, GcsCard, GcsIconSvg, GcsModal } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { deleteChatEmote, deleteChatEmotePack, renameChatEmote, saveChatEmotePack } from "../actions";

type Pack = { id: number; name: string; enabled: boolean; emotes: GcsChatEmoteView[] };
type Confirm = { kind: "pack"; id: number; name: string } | { kind: "emote"; id: number; name: string };

/**
 * Emoticoanele Chat Pro în ACP: un card pe pachet (numele, pornit / oprit, încărcarea în masă prin
 * `/api/acp/chat-pro/emotes`, grila cu codurile editabile și ștergerea), plus un pachet nou. Ștergerile cer confirmare
 * într-un dialog din pagină.
 */
export function GcsEmoteAdmin({ packs, canEdit, canDelete }: { packs: Pack[]; canEdit: boolean; canDelete: boolean }) {
  const t = useTranslations("acp.chatPro.emotes");
  const tErr = useTranslations("errors");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [adding, setAdding] = useState(false);

  const done = (res: GcsResult<unknown>, ok?: string) => {
    if (!res.ok) return setStatus({ ok: false, text: errorMessage(res.error) });
    setStatus(ok ? { ok: true, text: ok } : null);
    router.refresh();
  };

  const upload = (packId: number) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("packId", String(packId));
    start(async () => {
      const res = await fetch("/api/acp/chat-pro/emotes", { method: "POST", body: fd })
        .then((r) => r.json() as Promise<GcsResult<{ added: GcsChatEmoteView[]; rejected: { name: string; reason: string }[] }>>)
        .catch(() => null);
      if (!res) return setStatus({ ok: false, text: tErr("internal") });
      if (!res.ok) return setStatus({ ok: false, text: errorMessage(res.error) });
      form.reset();
      const rejected = res.data.rejected.map((r) => `${r.name}: ${tErr.has(`fields.${r.reason}`) ? tErr(`fields.${r.reason}`) : r.reason}`);
      setStatus({ ok: rejected.length === 0, text: [t("uploaded", { count: res.data.added.length }), ...rejected].join(" · ") });
      router.refresh();
    });
  };

  const packForm = (pack: Pack | null) => (
    <form
      key={pack?.id ?? "new"}
      style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await saveChatEmotePack(pack?.id ?? null, fd);
          if (res.ok) setAdding(false);
          done(res, t("saved"));
        });
      }}
      data-testid={pack ? "gcs-acp-pack-form" : "gcs-acp-pack-new"}
    >
      <input className="gcs-input" name="name" defaultValue={pack?.name ?? ""} placeholder={t("packName")} aria-label={t("packName")} maxLength={40} required style={{ flex: "1 1 200px" }} />
      <label className="gcs-check">
        <input type="checkbox" role="switch" className="gcs-chat__switch" name="enabled" defaultChecked={pack?.enabled ?? true} />
        {t("enabled")}
      </label>
      <GcsButton type="submit" variant={pack ? "ghost" : "primary"} size="sm" disabled={pending}>
        {pack ? t("savePack") : t("createPack")}
      </GcsButton>
    </form>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1000 }} data-testid="gcs-acp-chatpro-emotes">
      {packs.length === 0 && (
        <GcsCard style={{ padding: 16 }}>
          <p className="gcs-muted" style={{ margin: 0 }}>
            {t("empty")}
          </p>
        </GcsCard>
      )}
      {packs.map((pack) => (
        <GcsCard key={pack.id} as="section" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }} aria-label={pack.name} data-testid="gcs-acp-pack">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
            {canEdit ? packForm(pack) : <strong>{pack.name}</strong>}
            {canDelete && (
              <GcsButton variant="ghost" size="sm" onClick={() => setConfirm({ kind: "pack", id: pack.id, name: pack.name })}>
                <GcsIconSvg icon={faTrashCan} /> {t("deletePack")}
              </GcsButton>
            )}
          </div>
          {canEdit && (
            <form onSubmit={upload(pack.id)} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <input type="file" name="files" accept="image/png,image/gif,image/webp" multiple required aria-label={t("files")} data-testid="gcs-acp-emote-files" />
              <GcsButton type="submit" variant="primary" size="sm" disabled={pending} data-testid="gcs-acp-emote-upload">
                <GcsIconSvg icon={faCloudArrowUp} /> {t("upload")}
              </GcsButton>
            </form>
          )}
          {pack.emotes.length === 0 ? (
            <p className="gcs-muted" style={{ margin: 0 }}>
              {t("noEmotes")}
            </p>
          ) : (
            <div className="gcs-emoteAdmin__grid">
              {pack.emotes.map((e) => (
                <div key={e.id} className="gcs-emoteAdmin__item" data-testid="gcs-acp-emote">
                  <img src={e.url} alt={`:${e.code}:`} width={e.width} height={e.height} loading="lazy" />
                  {canEdit ? (
                    <form
                      onSubmit={(ev) => {
                        ev.preventDefault();
                        const code = String(new FormData(ev.currentTarget).get("code") ?? "");
                        start(async () => done(await renameChatEmote(e.id, code), t("saved")));
                      }}
                    >
                      <input className="gcs-input" name="code" defaultValue={e.code} aria-label={t("code")} maxLength={34} />
                      <GcsButton type="submit" variant="ghost" size="sm" aria-label={t("rename")} title={t("rename")} disabled={pending}>
                        <GcsIconSvg icon={faPen} />
                      </GcsButton>
                    </form>
                  ) : (
                    <code>:{e.code}:</code>
                  )}
                  {canDelete && (
                    <GcsButton variant="ghost" size="sm" onClick={() => setConfirm({ kind: "emote", id: e.id, name: `:${e.code}:` })}>
                      <GcsIconSvg icon={faTrashCan} /> {t("delete")}
                    </GcsButton>
                  )}
                </div>
              ))}
            </div>
          )}
        </GcsCard>
      ))}
      {canEdit &&
        (adding ? (
          <GcsCard style={{ padding: 16 }}>{packForm(null)}</GcsCard>
        ) : (
          <div>
            <GcsButton variant="primary" onClick={() => setAdding(true)} data-testid="gcs-acp-pack-add">
              <GcsIconSvg icon={faPlus} /> {t("addPack")}
            </GcsButton>
          </div>
        ))}
      {status && (
        <p role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-muted" : "gcs-notice gcs-notice--error"} style={{ margin: 0 }} data-testid="gcs-acp-emote-status">
          {status.text}
        </p>
      )}
      {confirm && (
        <GcsModal title={confirm.kind === "pack" ? t("confirmPackTitle") : t("confirmEmoteTitle")} onClose={() => setConfirm(null)} closeLabel={t("cancel")} size="sm">
          <p style={{ marginTop: 0 }}>{confirm.kind === "pack" ? t("confirmPack", { name: confirm.name }) : t("confirmEmote", { name: confirm.name })}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <GcsButton
              variant="primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = confirm.kind === "pack" ? await deleteChatEmotePack(confirm.id) : await deleteChatEmote(confirm.id);
                  setConfirm(null);
                  done(res);
                })
              }
              data-testid="gcs-acp-emote-confirm"
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
