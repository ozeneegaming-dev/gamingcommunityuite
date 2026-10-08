"use client";

import { faDice, faFloppyDisk, faPlus, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { saveServerAdmin } from "./actions";

/** Literele AMXX în ordinea afișării (aceeași listă ca `GCS_ADMIN_FLAGS` din aplicația Servere). */
const FLAGS = "abcdefghijklmnopqrstuvz";
const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type GcsServerAdminFormValues = {
  id: number | null;
  subject: "USER" | "PLAYER" | "NAME";
  user: { id: string; name: string } | null;
  identity: string;
  identityKind: "steam" | "nonsteam";
  name: string;
  hasPassword: boolean;
  serverId: number | null;
  presetId: number | null;
  flags: string | null;
  immunity: number | null;
  allowNonSteam: boolean;
  note: string;
  expiresAt: string | null;
};

type Props = {
  values: GcsServerAdminFormValues;
  servers: { id: number; name: string }[];
  presets: { id: number; name: string; flags: string; immunity: number }[];
};

/** O parolă aleatorie de 12 caractere, generată în browser (nu pleacă nicăieri până la salvare). */
function randomPassword(): string {
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join("");
}

/** Data de expirare pentru `<input type="datetime-local">` (ora locală a browserului). */
function localValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Formularul unui admin de server (specul 2026-10-08-servere-bridge §7): subiectul (membru, identitate, nume + parolă),
 * serverul sau „toate serverele”, presetarea sau flag-uri proprii, imunitatea, expirarea, nota și „Permite ID-urile
 * non-Steam” (cu avertisment).
 */
export function GcsServerAdminForm({ values, servers, presets }: Props) {
  const t = useTranslations("acp.serverAdmins");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [subject, setSubject] = useState(values.subject);
  const [user, setUser] = useState(values.user);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ id: string; name: string }[]>([]);
  const [presetId, setPresetId] = useState<number | null>(values.presetId);
  const [custom, setCustom] = useState(values.flags !== null);
  const [password, setPassword] = useState("");
  const [nonSteam, setNonSteam] = useState(values.allowNonSteam);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const preset = presets.find((p) => p.id === presetId) ?? null;
  const shownFlags = custom ? (values.flags ?? preset?.flags ?? "") : (preset?.flags ?? "");

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setFound([]);
      return;
    }
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

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Expirarea pleacă în ISO (ora locală a adminului), nu ca text fără fus orar.
    const local = String(fd.get("expiresLocal") ?? "");
    fd.set("expiresAt", local ? new Date(local).toISOString() : "");
    setPending(true);
    setStatus(null);
    const result = await saveServerAdmin(values.id, fd);
    setPending(false);
    if (!result.ok) return setStatus({ ok: false, text: errorMessage(result.error) });
    setStatus({ ok: true, text: t("saved") });
    router.push("/admin/gaming/server-admins");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }} data-testid="gcs-server-admin-form">
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: "6px 18px" }}>
        <legend style={{ marginBottom: 6, fontWeight: 700 }}>{t("fields.subject")}</legend>
        {(["USER", "PLAYER", "NAME"] as const).map((s) => (
          <label key={s} className="gcs-checkRow">
            <input type="radio" name="subject" value={s} checked={subject === s} onChange={() => setSubject(s)} />
            {t(`subjects.${s}`)}
          </label>
        ))}
      </fieldset>

      {subject === "USER" && (
        <div className="gcs-field" role="group" aria-label={t("fields.user")}>
          <span>{t("fields.user")}</span>
          {user ? (
            <span className="gcs-chip" style={{ alignSelf: "flex-start" }} data-testid="gcs-server-admin-user">
              <input type="hidden" name="userId" value={user.id} />
              {user.name}
              <button type="button" aria-label={t("fields.userRemove")} onClick={() => setUser(null)}>
                <GcsIconSvg icon={faXmark} />
              </button>
            </span>
          ) : (
            <>
              <input className="gcs-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("fields.userSearch")} aria-label={t("fields.userSearch")} autoComplete="off" data-testid="gcs-server-admin-user-search" />
              {found.length > 0 && (
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {found.map((u) => (
                    <li key={u.id}>
                      <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" onClick={() => (setUser(u), setQuery(""), setFound([]))}>
                        <GcsIconSvg icon={faPlus} />
                        {u.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <span className="gcs-field__hint">{t("fields.userHint")}</span>
          <label className="gcs-checkRow">
            <input type="checkbox" name="allowNonSteam" checked={nonSteam} onChange={(e) => setNonSteam(e.target.checked)} />
            {t("fields.allowNonSteam")}
          </label>
          {nonSteam && (
            <span role="note" style={{ color: "var(--gcs-warn, #F4B740)", fontSize: 13 }}>
              <GcsIconSvg icon={faTriangleExclamation} /> {t("fields.allowNonSteamWarning")}
            </span>
          )}
        </div>
      )}

      {subject === "PLAYER" && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label className="gcs-field" style={{ flex: "1 1 280px" }}>
            {t("fields.identity")}
            <input className="gcs-input" name="identity" defaultValue={values.identity} placeholder="STEAM_0:1:12345 / 7656119… / [U:1:…]" maxLength={40} required />
            <span className="gcs-field__hint">{t("fields.identityHint")}</span>
          </label>
          <label className="gcs-field" style={{ width: 200 }}>
            {t("fields.identityKind")}
            <select className="gcs-input" name="identityKind" defaultValue={values.identityKind}>
              <option value="steam">{t("kinds.steam")}</option>
              <option value="nonsteam">{t("kinds.nonsteam")}</option>
            </select>
          </label>
        </div>
      )}

      {subject === "NAME" && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="gcs-field" style={{ flex: "1 1 220px" }}>
            {t("fields.name")}
            <input className="gcs-input" name="name" defaultValue={values.name} maxLength={32} required />
          </label>
          <label className="gcs-field" style={{ flex: "1 1 220px" }}>
            {t("fields.password")}
            <input className="gcs-input" name="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={values.hasPassword ? undefined : 8} maxLength={64} autoComplete="new-password" placeholder={values.hasPassword ? t("fields.passwordKeep") : ""} required={!values.hasPassword} data-testid="gcs-server-admin-password" />
          </label>
          <GcsButton type="button" variant="ghost" icon={<GcsIconSvg icon={faDice} />} onClick={() => setPassword(randomPassword())}>
            {t("fields.generate")}
          </GcsButton>
          <span className="gcs-field__hint" style={{ flexBasis: "100%" }}>
            {t("fields.passwordHint")}
          </span>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label className="gcs-field" style={{ flex: "1 1 240px" }}>
          {t("fields.server")}
          <select className="gcs-input" name="serverId" defaultValue={values.serverId ?? ""}>
            <option value="">{t("allServers")}</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="gcs-field" style={{ flex: "1 1 240px" }}>
          {t("fields.preset")}
          <select className="gcs-input" name="presetId" value={presetId ?? ""} onChange={(e) => setPresetId(e.target.value ? Number(e.target.value) : null)} data-testid="gcs-server-admin-preset">
            <option value="">{t("noPreset")}</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.flags})
              </option>
            ))}
          </select>
        </label>
        <label className="gcs-field" style={{ width: 160 }}>
          {t("fields.immunity")}
          <input className="gcs-input" type="number" name="immunity" min={0} max={100} defaultValue={values.immunity ?? ""} placeholder={preset ? String(preset.immunity) : "0"} />
        </label>
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <label className="gcs-checkRow">
          <input type="checkbox" name="customFlags" checked={custom || presetId === null} disabled={presetId === null} onChange={(e) => setCustom(e.target.checked)} />
          {t("fields.customFlags")}
          {presetId === null && <input type="hidden" name="customFlags" value="on" />}
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }} data-testid="gcs-server-admin-flags">
          {[...FLAGS].map((f) => (
            <label key={`${f}-${custom}-${presetId}`} className="gcs-checkRow" title={t(`flags.${f}`)}>
              <input type="checkbox" name="flag" value={f} defaultChecked={shownFlags.includes(f)} disabled={!(custom || presetId === null)} />
              <code>{f}</code> {t(`flags.${f}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label className="gcs-field" style={{ width: 260 }}>
          {t("fields.expiresAt")}
          <input className="gcs-input" type="datetime-local" name="expiresLocal" defaultValue={localValue(values.expiresAt)} />
          <span className="gcs-field__hint">{t("fields.expiresHint")}</span>
        </label>
        <label className="gcs-field" style={{ flex: "1 1 320px" }}>
          {t("fields.note")}
          <textarea className="gcs-input" name="note" defaultValue={values.note} maxLength={500} rows={2} />
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <GcsButton variant="primary" type="submit" disabled={pending} icon={<GcsIconSvg icon={faFloppyDisk} />} data-testid="gcs-server-admin-save">
          {t("save")}
        </GcsButton>
        {status && (
          <span role={status.ok ? "status" : "alert"} style={{ fontSize: 13, fontWeight: 600, color: status.ok ? "var(--gcs-ok)" : "#FF8A91" }}>
            {status.text}
          </span>
        )}
      </div>
    </form>
  );
}
