"use client";

import { faArrowUpFromBracket } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg, GcsUploadDialog } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { UPLOAD_RULES, uploadLabels } from "@/lib/ui-labels";
import { useUploadPost } from "@/lib/upload-request";
import { useErrorMessage } from "@/lib/use-error-message";
import { createSanction, liftSanction, updateSanction } from "../../bridge-actions";
import { GcsPlayerPicker, type GcsPickedPlayer } from "./GcsPlayerPicker";

type Type = "BAN" | "MUTE" | "GAG";
type Scope = "SERVER" | "GLOBAL";

/** Ce poate da actorul (din `bridge.sanctions.abilities`), cu serverele vizibile lui. */
export type GcsSanctionAbilities = {
  staff: boolean;
  grants: { serverId: number | null; flags: string }[];
  tempbanMax: number;
  servers: { id: number; name: string }[];
};

/** Duratele propuse (minute); 0 = permanent. */
const PRESETS = [30, 60, 1440, 10_080, 43_200, 0] as const;

/** Flag-urile actorului pe un server (cu intrările „toate serverele”); `null` = pe toate serverele. */
function flagsOn(a: GcsSanctionAbilities, serverId: number | null): string {
  return a.grants.filter((g) => g.serverId === null || (serverId !== null && g.serverId === serverId)).map((g) => (serverId === null && g.serverId !== null ? "" : g.flags)).join("");
}

/** Poate actorul da tipul dat, cu scopul, serverul și durata date? (Aceeași regulă ca serviciul, pentru opțiunile arătate.) */
export function allowed(a: GcsSanctionAbilities, type: Type, scope: Scope, serverId: number | null, minutes: number): boolean {
  if (a.staff) return true;
  const flags = flagsOn(a, scope === "GLOBAL" ? null : serverId);
  if (scope === "SERVER" && serverId === null) return false;
  if (type !== "BAN") return flags.includes("i");
  if (flags.includes("d")) return true;
  return flags.includes("v") && minutes > 0 && minutes <= a.tempbanMax;
}

/** Capturile-dovadă: limitele serverului (`SANCTION_EVIDENCE_MAX_BYTES` = 5 MB, imaginile pipeline-ului). */
const EVIDENCE_RULES = UPLOAD_RULES.image(5);

type Initial = { scope: Scope; serverId: number | null; reason: string; minutes: number; evidence: string[] };

/**
 * Formularul unei sancțiuni de pe site (specul 2026-10-08-servere-pagini §4): crearea (tipul, ținta, scopul „acest
 * server” / „toate serverele”, motivul, durata, dovezile) sau modificarea (fără tip și țintă). Opțiunile arătate
 * respectă drepturile actorului; serviciul le verifică oricum.
 */
export function GcsSanctionForm({ mode, abilities, sanctionId, type: fixedType, initial, initialPlayer }: { mode: "create" | "edit"; abilities: GcsSanctionAbilities; sanctionId?: number; type?: Type; initial?: Initial; initialPlayer?: GcsPickedPlayer | null }) {
  const t = useTranslations("bridge.sanctionForm");
  const tt = useTranslations("bridge.sanction.type");
  const tf = useTranslations("errors.fields");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const tu = useTranslations("ui");
  const post = useUploadPost();
  const uid = useId();
  const firstServer = abilities.servers.find((s) => abilities.staff || flagsOn(abilities, s.id) !== "")?.id ?? null;
  const [type, setType] = useState<Type>(fixedType ?? "BAN");
  const [targetMode, setTargetMode] = useState<"player" | "id">("player");
  const [player, setPlayer] = useState<GcsPickedPlayer | null>(initialPlayer ?? null);
  const [auth, setAuth] = useState("");
  const [authKind, setAuthKind] = useState<"steam" | "nonsteam">("steam");
  const [ip, setIp] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>(initial?.scope ?? "SERVER");
  const [serverId, setServerId] = useState<number | null>(initial?.serverId ?? firstServer);
  const [reason, setReason] = useState(initial?.reason ?? "");
  const startMinutes = initial?.minutes ?? 1440;
  const [preset, setPreset] = useState<string>((PRESETS as readonly number[]).includes(startMinutes) ? String(startMinutes) : "custom");
  const [custom, setCustom] = useState(String(startMinutes || 60));
  const [evidence, setEvidence] = useState((initial?.evidence ?? []).join("\n"));
  const [files, setFiles] = useState<{ id: string; url: string }[]>([]);
  /** Popupul de încărcare al capturilor (mai multe odată; cel mult 10). */
  const [picking, setPicking] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  const minutes = preset === "custom" ? Math.max(0, Math.floor(Number(custom) || 0)) : Number(preset);
  const canGlobal = allowed(abilities, type, "GLOBAL", null, minutes);
  const ok = allowed(abilities, type, scope, serverId, minutes);
  const fieldError = (key: string) =>
    fieldErrors[key] ? (
      <span className="gcs-formError" role="alert">
        {tf.has(fieldErrors[key]!) ? tf(fieldErrors[key]!) : fieldErrors[key]}
      </span>
    ) : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setStatus(null);
    setFieldErrors({});
    const urls = evidence
      .split(/\s+/)
      .map((u) => u.trim())
      .filter(Boolean);
    const common = { scope, serverId: scope === "SERVER" ? serverId : (serverId ?? null), reason, minutes, evidence: urls };
    const res =
      mode === "create"
        ? await createSanction({
            ...common,
            type,
            target: targetMode === "player" ? { playerId: player?.id ?? null, ip: ip || null } : { auth: auth || null, authKind, ip: ip || null, name: name || null },
            attachmentIds: files.map((f) => f.id),
          })
        : await updateSanction({ sanctionId: sanctionId!, ...common });
    setPending(false);
    if (!res.ok) {
      setFieldErrors(res.error.fields ?? {});
      setStatus({ ok: false, text: errorMessage(res.error) });
      return;
    }
    if (mode === "create") {
      router.push(`/bans/${(res.data as { id: number }).id}`);
      return;
    }
    setStatus({ ok: true, text: t("saved") });
    router.refresh();
  }

  return (
    <form className="gcs-sanctionForm" onSubmit={onSubmit} data-testid={`gcs-sanction-form-${mode}`}>
      {mode === "create" && (
        <fieldset className="gcs-sanctionForm__group">
          <legend>{t("type")}</legend>
          <div className="gcs-optionRow">
            {(["BAN", "MUTE", "GAG"] as const).map((k) => (
              <label key={k} className="gcs-option" data-type={k}>
                <input type="radio" name={`${uid}-type`} value={k} checked={type === k} onChange={() => setType(k)} />
                <span>{tt(k)}</span>
                <span className="gcs-option__hint">{t(`typeHint.${k}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {mode === "create" && (
        <fieldset className="gcs-sanctionForm__group">
          <legend>{t("target")}</legend>
          <div className="gcs-segLinks" role="radiogroup" aria-label={t("targetMode")}>
            {(["player", "id"] as const).map((m) => (
              <label key={m} className={`gcs-segLink${targetMode === m ? " gcs-segLink--active" : ""}`}>
                <input type="radio" className="gcs-srOnly" name={`${uid}-target`} checked={targetMode === m} onChange={() => setTargetMode(m)} />
                {t(`targetModes.${m}`)}
              </label>
            ))}
          </div>
          {targetMode === "player" ? (
            <GcsPlayerPicker value={player} onChange={setPlayer} label={t("player")} hint={t("playerHint")} testId="gcs-sanction-player" />
          ) : (
            <div className="gcs-formRow">
              <label className="gcs-field" style={{ flex: "2 1 220px" }}>
                <span>{t("auth")}</span>
                <input className="gcs-input" value={auth} onChange={(e) => setAuth(e.target.value)} maxLength={64} placeholder="STEAM_0:1:12345" data-testid="gcs-sanction-auth" />
              </label>
              <label className="gcs-field" style={{ flex: "1 1 140px" }}>
                <span>{t("authKind")}</span>
                <select className="gcs-input" value={authKind} onChange={(e) => setAuthKind(e.target.value as "steam" | "nonsteam")}>
                  <option value="steam">{t("kinds.steam")}</option>
                  <option value="nonsteam">{t("kinds.nonsteam")}</option>
                </select>
              </label>
              <label className="gcs-field" style={{ flex: "1 1 180px" }}>
                <span>{t("name")}</span>
                <input className="gcs-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
                <span className="gcs-field__hint">{t("nameHint")}</span>
              </label>
            </div>
          )}
          <label className="gcs-field" style={{ maxWidth: 280 }}>
            <span>{t("ip")}</span>
            <input className="gcs-input" value={ip} onChange={(e) => setIp(e.target.value)} maxLength={64} inputMode="text" />
            <span className="gcs-field__hint">{t("ipHint")}</span>
          </label>
          {fieldError("target")}
          {fieldError("ip")}
          {fieldError("name")}
        </fieldset>
      )}

      <fieldset className="gcs-sanctionForm__group">
        <legend>{t("scope")}</legend>
        <div className="gcs-optionRow">
          <label className="gcs-option">
            <input type="radio" name={`${uid}-scope`} checked={scope === "SERVER"} onChange={() => setScope("SERVER")} data-testid="gcs-sanction-scope-server" />
            <span>{t("scopes.SERVER")}</span>
          </label>
          <label className="gcs-option" aria-disabled={!canGlobal}>
            <input type="radio" name={`${uid}-scope`} checked={scope === "GLOBAL"} disabled={!canGlobal && scope !== "GLOBAL"} onChange={() => setScope("GLOBAL")} data-testid="gcs-sanction-scope-global" />
            <span>{t("scopes.GLOBAL")}</span>
            {!canGlobal && <span className="gcs-option__hint">{t("globalDenied")}</span>}
          </label>
        </div>
        <label className="gcs-field" style={{ maxWidth: 360 }}>
          <span>{scope === "SERVER" ? t("server") : t("originServer")}</span>
          <select className="gcs-input" value={serverId ?? ""} onChange={(e) => setServerId(e.target.value ? Number(e.target.value) : null)} data-testid="gcs-sanction-server">
            {scope === "GLOBAL" && <option value="">{t("noServer")}</option>}
            {abilities.servers
              .filter((s) => abilities.staff || flagsOn(abilities, s.id) !== "" || (scope === "GLOBAL" && s.id === serverId))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
        {fieldError("serverId")}
        {fieldError("scope")}
      </fieldset>

      <fieldset className="gcs-sanctionForm__group">
        <legend>{t("details")}</legend>
        <label className="gcs-field">
          <span>{t("reason")}</span>
          <input className="gcs-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} required data-testid="gcs-sanction-reason" />
          {fieldError("reason")}
        </label>
        <div className="gcs-formRow">
          <label className="gcs-field" style={{ flex: "1 1 220px" }}>
            <span>{t("duration")}</span>
            <select className="gcs-input" value={preset} onChange={(e) => setPreset(e.target.value)} data-testid="gcs-sanction-duration">
              {PRESETS.map((m) => (
                <option key={m} value={m}>
                  {t(`presets.${m}`)}
                </option>
              ))}
              <option value="custom">{t("presets.custom")}</option>
            </select>
          </label>
          {preset === "custom" && (
            <label className="gcs-field" style={{ flex: "1 1 160px" }}>
              <span>{t("minutes")}</span>
              <input className="gcs-input" type="number" min={0} max={5_256_000} value={custom} onChange={(e) => setCustom(e.target.value)} />
            </label>
          )}
        </div>
        {mode === "edit" && <span className="gcs-field__hint">{t("durationFromStart")}</span>}
        {fieldError("minutes")}
        <label className="gcs-field">
          <span>{t("evidence")}</span>
          <textarea className="gcs-input" rows={3} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="https://" data-testid="gcs-sanction-evidence" />
          <span className="gcs-field__hint">{t("evidenceHint")}</span>
          {fieldError("evidence")}
        </label>
        {mode === "create" && (
          <div className="gcs-field">
            <span>{t("images")}</span>
            <div>
              <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faArrowUpFromBracket} />} disabled={files.length >= 10} onClick={() => setPicking(true)} data-testid="gcs-sanction-files-open">
                {tu("upload.upload")}
              </GcsButton>
            </div>
            <span className="gcs-field__hint">{t("imagesHint")}</span>
            {picking && (
              <GcsUploadDialog
                title={t("images")}
                rules={EVIDENCE_RULES}
                labels={uploadLabels(tu)}
                multiple
                uploadMany={async (chosen, onProgress) => {
                  // Câte una, cu progresul total; cel mult 10 capturi pe sancțiune.
                  const batch = chosen.slice(0, Math.max(0, 10 - files.length));
                  for (const [i, file] of batch.entries()) {
                    const fd = new FormData();
                    fd.set("file", file);
                    const res = await post<{ id: string; url: string }>("/api/servers/evidence", fd, (f) => onProgress((i + f) / batch.length));
                    if (!res.ok) return res.error;
                    setFiles((list) => [...list, res.data].slice(0, 10));
                  }
                  return null;
                }}
                onAccept={() => setPicking(false)}
                onAcceptMany={() => setPicking(false)}
                onClose={() => setPicking(false)}
                testId="gcs-sanction-files"
              />
            )}
            {fieldError("attachments")}
            {files.length > 0 && (
              <ul className="gcs-evidenceThumbs" data-testid="gcs-sanction-thumbs">
                {files.map((f) => (
                  <li key={f.id}>
                    <img src={f.url} alt="" />
                    <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" onClick={() => setFiles((list) => list.filter((x) => x.id !== f.id))}>
                      {t("removeImage")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </fieldset>

      {!ok && <p className="gcs-notice gcs-notice--warn">{t("notAllowed")}</p>}
      <div className="gcs-formActions">
        <button type="submit" className="gcs-btn gcs-btn--primary" disabled={pending} data-testid="gcs-sanction-submit">
          {mode === "create" ? t("submitCreate") : t("submitEdit")}
        </button>
        {status && (
          <span role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-formOk" : "gcs-formError"}>
            {status.text}
          </span>
        )}
      </div>
    </form>
  );
}

/** Ridicarea unei sancțiuni (unban / unmute / ungag), cu motivul obligatoriu. */
export function GcsSanctionLift({ sanctionId }: { sanctionId: number }) {
  const t = useTranslations("bridge.sanctionForm");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="gcs-liftForm"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const res = await liftSanction({ sanctionId, reason });
        setPending(false);
        if (!res.ok) return setError(errorMessage(res.error));
        router.refresh();
      }}
      data-testid="gcs-sanction-lift"
    >
      <label className="gcs-field">
        <span>{t("liftReason")}</span>
        <input className="gcs-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} required data-testid="gcs-sanction-lift-reason" />
      </label>
      <button type="submit" className="gcs-btn gcs-btn--ghost" disabled={pending} data-testid="gcs-sanction-lift-submit">
        {t("lift")}
      </button>
      {error && (
        <span role="alert" className="gcs-formError">
          {error}
        </span>
      )}
    </form>
  );
}
