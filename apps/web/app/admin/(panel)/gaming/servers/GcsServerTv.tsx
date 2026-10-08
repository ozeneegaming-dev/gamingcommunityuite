"use client";

import { faPlugCircleCheck } from "@fortawesome/free-solid-svg-icons";
import type { GcsResult } from "@gcs/core";
import type { GcsServerTvView, GcsTvTestResult } from "@gcs/modules";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { GcsActionForm } from "../../_components/GcsActionForm";

/** Fusurile orare des folosite (lista completă e acceptată oricum, scrisă de mână). */
const ZONES = ["UTC", "Europe/Bucharest", "Europe/Chisinau", "Europe/London", "Europe/Berlin", "Europe/Paris", "Europe/Madrid", "Europe/Moscow", "Europe/Istanbul", "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Sao_Paulo", "Asia/Dubai"];

type Props = {
  view: GcsServerTvView;
  canEdit: boolean;
  save: (fd: FormData) => Promise<GcsResult<null>>;
  test: () => Promise<GcsResult<GcsTvTestResult>>;
};

/**
 * Formularul „HLTV / GOTV și demo-uri” (specul 2026-10-08-servere-hltv §2.1, §7): adresa de vizionare și întârzierea,
 * sursa demo-urilor cu câmpurile ei (FTP / FTPS / SFTP, folderul HTTP, încărcarea pluginului CS2), filtrul numelor, fusul
 * orar, înregistrarea opțională (modulul CS2 / rcon-ul HLTV pe CS 1.6). Secretele nu vin niciodată înapoi: câmpurile
 * goale le păstrează, bifa „Șterge” le scoate. „Testează conexiunea” folosește setările salvate.
 */
export function GcsServerTv({ view, canEdit, save, test }: Props) {
  const t = useTranslations("acp.bridge.tv");
  const errorMessage = useErrorMessage();
  const [source, setSource] = useState(view.source);
  const [record, setRecord] = useState(view.record);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const remote = source === "ftp" || source === "ftps" || source === "sftp";
  const cs16 = view.game === "cs16";

  async function runTest() {
    setTesting(true);
    setResult(null);
    const res = await test();
    setTesting(false);
    if (!res.ok) return setResult({ ok: false, text: errorMessage(res.error) });
    const r = res.data;
    if (!r.ok) return setResult({ ok: false, text: t("test.failed", { error: t.has(`errors.${r.error}`) ? t(`errors.${r.error}`) : r.error }) });
    setResult({ ok: true, text: `${t("test.ok", { files: r.files })}${r.sample.length > 0 ? ` ${r.sample.join(", ")}` : ""}${r.hostKey ? ` · ${t("test.hostKey", { key: r.hostKey })}` : ""}` });
  }

  const secretHint = (has: boolean) => (has ? t("secret.saved") : t("secret.none"));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <GcsActionForm action={save} submitLabel={t("save")} submitKind="save">
        <fieldset className="gcs-tvFieldset" disabled={!canEdit}>
          <legend>{t("watch.title")}</legend>
          <label className="gcs-field">
            {t("watch.address")}
            <input className="gcs-input" name="address" defaultValue={view.address} placeholder="217.156.22.86:27020" maxLength={260} autoComplete="off" data-testid="gcs-tv-address" />
            <span className="gcs-field__hint">{t("watch.addressHint")}</span>
          </label>
          <label className="gcs-field" style={{ maxWidth: 240 }}>
            {t("watch.delay")}
            <input className="gcs-input" name="delay" type="number" min={0} max={3600} defaultValue={view.delay ?? ""} data-testid="gcs-tv-delay" />
            <span className="gcs-field__hint">{cs16 ? t("watch.delayHintCs16") : t("watch.delayHintCs2")}</span>
          </label>
        </fieldset>

        <fieldset className="gcs-tvFieldset" disabled={!canEdit}>
          <legend>{t("source.title")}</legend>
          <label className="gcs-field" style={{ maxWidth: 420 }}>
            {t("source.label")}
            <select className="gcs-input" name="source" value={source} onChange={(e) => setSource(e.target.value as GcsServerTvView["source"])} data-testid="gcs-tv-source">
              <option value="none">{t("source.none")}</option>
              <option value="ftp">{t("source.ftp")}</option>
              <option value="ftps">{t("source.ftps")}</option>
              <option value="sftp">{t("source.sftp")}</option>
              <option value="http">{t("source.http")}</option>
              {!cs16 && <option value="plugin">{t("source.plugin")}</option>}
            </select>
            <span className="gcs-field__hint">{t(`source.hints.${source}`)}</span>
          </label>

          <div hidden={!remote} className="gcs-tvGrid">
            <label className="gcs-field">
              {t("remote.host")}
              <input className="gcs-input" name="host" defaultValue={view.host} placeholder="ftp.exemplu.ro" autoComplete="off" data-testid="gcs-tv-host" />
            </label>
            <label className="gcs-field">
              {t("remote.port")}
              <input className="gcs-input" name="port" type="number" min={1} max={65535} defaultValue={view.port ?? ""} placeholder={source === "sftp" ? "22" : "21"} />
            </label>
            <label className="gcs-field">
              {t("remote.username")}
              <input className="gcs-input" name="username" defaultValue={view.username} autoComplete="off" data-testid="gcs-tv-username" />
            </label>
            <label className="gcs-field">
              {source === "sftp" ? t("remote.passwordOrPassphrase") : t("remote.password")}
              <input className="gcs-input" name="password" type="password" autoComplete="new-password" placeholder={view.hasPassword ? "••••••••" : ""} data-testid="gcs-tv-password" />
              <span className="gcs-field__hint">{secretHint(view.hasPassword)}</span>
            </label>
            {view.hasPassword && (
              <label className="gcs-checkRow">
                <input type="checkbox" name="clearPassword" />
                {t("secret.clear")}
              </label>
            )}
            <label className="gcs-field" style={{ gridColumn: "1 / -1" }}>
              {t("remote.dir")}
              <input className="gcs-input" name="remoteDir" defaultValue={view.remoteDir} placeholder="/cstrike/demos" data-testid="gcs-tv-dir" />
            </label>
            {source === "ftps" && (
              <label className="gcs-checkRow" style={{ gridColumn: "1 / -1" }}>
                <input type="checkbox" name="tlsInsecure" defaultChecked={view.tlsInsecure} />
                {t("remote.tlsInsecure")}
              </label>
            )}
            {source === "sftp" && (
              <>
                <label className="gcs-field" style={{ gridColumn: "1 / -1" }}>
                  {t("remote.privateKey")}
                  <textarea className="gcs-input" name="privateKey" rows={4} autoComplete="off" spellCheck={false} placeholder={view.hasPrivateKey ? t("secret.saved") : "-----BEGIN OPENSSH PRIVATE KEY-----"} style={{ fontFamily: "var(--gcs-font-mono, monospace)", fontSize: 12 }} />
                  <span className="gcs-field__hint">{secretHint(view.hasPrivateKey)}</span>
                </label>
                {view.hasPrivateKey && (
                  <label className="gcs-checkRow">
                    <input type="checkbox" name="clearPrivateKey" />
                    {t("secret.clearKey")}
                  </label>
                )}
                <label className="gcs-field" style={{ gridColumn: "1 / -1" }}>
                  {t("remote.hostKey")}
                  <input className="gcs-input" name="hostKey" defaultValue={view.hostKey} placeholder="SHA256:…" spellCheck={false} style={{ fontFamily: "var(--gcs-font-mono, monospace)" }} />
                  <span className="gcs-field__hint">{t("remote.hostKeyHint")}</span>
                </label>
              </>
            )}
          </div>

          <label className="gcs-field" hidden={source !== "http"}>
            {t("http.template")}
            <input className="gcs-input" name="httpTemplate" defaultValue={view.httpTemplate} placeholder="https://demos.exemplu.ro/cstrike/{file}" maxLength={500} spellCheck={false} data-testid="gcs-tv-http" />
            <span className="gcs-field__hint">{t("http.hint")}</span>
          </label>

          <div hidden={source === "none" || source === "plugin"} className="gcs-tvGrid">
            <label className="gcs-field">
              {t("match.prefix")}
              <input className="gcs-input" name="namePrefix" defaultValue={view.namePrefix} maxLength={32} placeholder="mix" />
              <span className="gcs-field__hint">{t("match.prefixHint")}</span>
            </label>
            <label className="gcs-field">
              {t("match.timeZone")}
              <input className="gcs-input" name="timeZone" defaultValue={view.timeZone} list="gcs-tv-zones" maxLength={64} data-testid="gcs-tv-timezone" />
              <datalist id="gcs-tv-zones">
                {ZONES.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
              <span className="gcs-field__hint">{t("match.timeZoneHint")}</span>
            </label>
          </div>
        </fieldset>

        <fieldset className="gcs-tvFieldset" disabled={!canEdit}>
          <legend>{t("record.title")}</legend>
          <label className="gcs-checkRow">
            <input type="checkbox" name="record" checked={record} onChange={(e) => setRecord(e.target.checked)} data-testid="gcs-tv-record" />
            {cs16 ? t("record.cs16") : t("record.cs2")}
          </label>
          <span className="gcs-field__hint">{cs16 ? t("record.cs16Hint") : t("record.cs2Hint")}</span>
          {cs16 && (
            <div hidden={!record} className="gcs-tvGrid">
              <label className="gcs-field">
                {t("record.rconPassword")}
                <input className="gcs-input" name="rconPassword" type="password" autoComplete="new-password" placeholder={view.hasRconPassword ? "••••••••" : ""} />
                <span className="gcs-field__hint">{secretHint(view.hasRconPassword)}</span>
              </label>
              {view.hasRconPassword && (
                <label className="gcs-checkRow">
                  <input type="checkbox" name="clearRconPassword" />
                  {t("secret.clear")}
                </label>
              )}
            </div>
          )}
        </fieldset>
      </GcsActionForm>

      {canEdit && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <GcsButton type="button" variant="ghost" disabled={testing || view.source === "none" || view.source === "plugin"} icon={<GcsIconSvg icon={faPlugCircleCheck} />} onClick={() => void runTest()} data-testid="gcs-tv-test">
            {testing ? t("test.running") : t("test.button")}
          </GcsButton>
          <span className="gcs-field__hint">{t("test.hint")}</span>
          {result && (
            <span role={result.ok ? "status" : "alert"} data-testid="gcs-tv-test-result" style={{ fontSize: 13, fontWeight: 600, color: result.ok ? "var(--gcs-ok)" : "#FF8A91", overflowWrap: "anywhere" }}>
              {result.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
