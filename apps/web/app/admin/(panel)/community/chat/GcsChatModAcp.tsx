"use client";

import { faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { GcsResult } from "@gcs/core";
import { GcsButton, GcsIconSvg, GcsModal } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { saveChatGrant } from "./actions";

/**
 * Un buton cu confirmare în pagină (niciodată `confirm()` nativ): „Ridică”, „Anulează”, „Revocă”. După acțiune, pagina
 * se reîmprospătează.
 */
export function GcsAcpConfirmAction(props: { label: string; title: string; body: string; confirm: string; run: () => Promise<GcsResult<unknown>>; testId?: string; danger?: boolean }) {
  const t = useTranslations("acp.chatMod");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <GcsButton variant="ghost" size="sm" className="gcs-sweep" onClick={() => setOpen(true)} {...(props.testId ? { "data-testid": props.testId } : {})}>
        {props.label}
      </GcsButton>
      {open && (
        <GcsModal title={props.title} onClose={() => setOpen(false)} closeLabel={t("cancel")} size="sm">
          <p>{props.body}</p>
          {error && (
            <p role="alert" className="gcs-chatModDialog__error">
              {error}
            </p>
          )}
          <div className="gcs-dialog__actions">
            <GcsButton variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </GcsButton>
            <GcsButton
              variant="primary"
              className={props.danger ? "gcs-chatModDialog__danger" : undefined}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await props.run();
                setBusy(false);
                if (!r.ok) return setError(errorMessage(r.error));
                setOpen(false);
                router.refresh();
              }}
              data-testid="gcs-acp-confirm"
            >
              {props.confirm}
            </GcsButton>
          </div>
        </GcsModal>
      )}
    </>
  );
}

const RIGHTS = ["edit_any", "pin", "hide", "delete_any", "purge_user", "warn", "mute", "kick", "ban", "slow_user"] as const;
const PRESETS: Record<"full" | "mute_kick", readonly string[]> = { full: RIGHTS, mute_kick: ["mute", "kick"] };
const EXPIRY = ["none", "1d", "7d", "30d", "custom"] as const;
const EXPIRY_MS: Record<string, number> = { "1d": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };

export type GcsChatGrantInitial = { user: { id: string; name: string }; rights: string[]; rooms: string[]; expiresAt: string | null };

/**
 * „Adaugă moderator de chat” (și editarea unui acces): membrul (căutare după nume), setul de drepturi (Complet / Doar
 * mute + kick / Personalizat), camerele (niciuna bifată = toate) și expirarea.
 */
export function GcsChatGrantForm({ rooms, initial, onDone }: { rooms: { key: string; name: string }[]; initial?: GcsChatGrantInitial; onDone?: () => void }) {
  const t = useTranslations("acp.chatMod");
  const tr = useTranslations("chat.mod.rights");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [user, setUser] = useState<{ id: string; name: string } | null>(initial?.user ?? null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ id: string; name: string }[]>([]);
  const presetOf = (rights: string[]) => (rights.length === RIGHTS.length ? "full" : rights.length === 2 && rights.includes("mute") && rights.includes("kick") ? "mute_kick" : "custom");
  const [preset, setPreset] = useState<"full" | "mute_kick" | "custom">(initial ? presetOf(initial.rights) : "mute_kick");
  const [rights, setRights] = useState<string[]>(initial?.rights ?? ["mute", "kick"]);
  const [picked, setPicked] = useState<string[]>(initial?.rooms ?? []);
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]>(initial?.expiresAt ? "custom" : "none");
  const [custom, setCustom] = useState(initial?.expiresAt ? initial.expiresAt.slice(0, 16) : "");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setFound([]);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/forums/mentions?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((r) => (r.ok ? (r.json() as Promise<{ users: { id: string; name: string }[] }>) : { users: [] }))
        .then((d) => setFound(d.users))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const choose = (p: typeof preset) => {
    setPreset(p);
    if (p !== "custom") setRights([...PRESETS[p]]);
  };
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return setStatus({ ok: false, text: t("pickMember") });
    const expiresAt = expiry === "none" ? null : expiry === "custom" ? (custom ? new Date(custom).toISOString() : null) : new Date(Date.now() + EXPIRY_MS[expiry]!).toISOString();
    setPending(true);
    setStatus(null);
    const res = await saveChatGrant({ userId: user.id, rights, rooms: picked, expiresAt });
    setPending(false);
    if (!res.ok) return setStatus({ ok: false, text: errorMessage(res.error) });
    setStatus({ ok: true, text: t("saved") });
    if (!initial) {
      setUser(null);
      setQuery("");
    }
    onDone?.();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="gcs-acpChatMod__form" data-testid="gcs-acp-chat-grant-form">
      <div className="gcs-field" role="group" aria-label={t("member")}>
        <span>{t("member")}</span>
        {user ? (
          <span className="gcs-chip" style={{ alignSelf: "flex-start" }} data-testid="gcs-acp-chat-grant-user">
            {user.name}
            {!initial && (
              <button type="button" aria-label={t("removeMember")} onClick={() => setUser(null)}>
                <GcsIconSvg icon={faXmark} />
              </button>
            )}
          </span>
        ) : (
          <>
            <input className="gcs-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchMember")} aria-label={t("searchMember")} autoComplete="off" data-testid="gcs-acp-chat-grant-search" />
            {found.length > 0 && (
              <ul className="gcs-acpChatMod__found">
                {found.map((u) => (
                  <li key={u.id}>
                    <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm gcs-sweep" onClick={() => (setUser(u), setQuery(""), setFound([]))}>
                      <GcsIconSvg icon={faPlus} />
                      {u.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <fieldset className="gcs-acpChatMod__set">
        <legend>{t("preset")}</legend>
        {(["full", "mute_kick", "custom"] as const).map((p) => (
          <label key={p} className="gcs-checkRow">
            <input type="radio" name="preset" checked={preset === p} onChange={() => choose(p)} data-testid={`gcs-acp-chat-grant-preset-${p}`} />
            {t(`presets.${p}`)}
          </label>
        ))}
      </fieldset>
      <fieldset className="gcs-acpChatMod__set" disabled={preset !== "custom"}>
        <legend>{t("rights")}</legend>
        {RIGHTS.map((r) => (
          <label key={r} className="gcs-checkRow">
            <input type="checkbox" checked={rights.includes(r)} onChange={() => setRights(toggle(rights, r))} />
            {tr(r)}
          </label>
        ))}
      </fieldset>
      <fieldset className="gcs-acpChatMod__set">
        <legend>{t("rooms")}</legend>
        <span className="gcs-field__hint">{t("roomsHint")}</span>
        {rooms.map((r) => (
          <label key={r.key} className="gcs-checkRow">
            <input type="checkbox" checked={picked.includes(r.key)} onChange={() => setPicked(toggle(picked, r.key))} />#{r.key} · {r.name}
          </label>
        ))}
      </fieldset>
      <fieldset className="gcs-acpChatMod__set">
        <legend>{t("expiry")}</legend>
        {EXPIRY.map((x) => (
          <label key={x} className="gcs-checkRow">
            <input type="radio" name="expiry" checked={expiry === x} onChange={() => setExpiry(x)} />
            {t(`expiries.${x}`)}
          </label>
        ))}
        {expiry === "custom" && <input className="gcs-input" type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label={t("expiries.custom")} />}
      </fieldset>
      {status && (
        <p role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-muted" : "gcs-chatModDialog__error"}>
          {status.text}
        </p>
      )}
      <div>
        <GcsButton type="submit" variant="primary" disabled={pending || rights.length === 0} data-testid="gcs-acp-chat-grant-save">
          {initial ? t("saveGrant") : t("addGrant")}
        </GcsButton>
      </div>
    </form>
  );
}

/** Editarea unui acces existent, în pagină (dialog cu formularul). */
export function GcsChatGrantEdit({ rooms, initial }: { rooms: { key: string; name: string }[]; initial: GcsChatGrantInitial }) {
  const t = useTranslations("acp.chatMod");
  const [open, setOpen] = useState(false);
  return (
    <>
      <GcsButton variant="ghost" size="sm" className="gcs-sweep" onClick={() => setOpen(true)} data-testid="gcs-acp-chat-grant-edit">
        {t("edit")}
      </GcsButton>
      {open && (
        <GcsModal title={t("editTitle", { name: initial.user.name })} onClose={() => setOpen(false)} closeLabel={t("cancel")} size="md">
          <GcsChatGrantForm rooms={rooms} initial={initial} onDone={() => setOpen(false)} />
        </GcsModal>
      )}
    </>
  );
}
