"use client";

import { faRightToBracket, faRotateLeft, faUserXmark } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { rememberAuthReturn } from "@/lib/auth-return";
import { cancelAccountDeletion, requestAccountDeletion } from "../../settings-actions";
import { GcsStatus } from "./GcsStatus";
import { useSettingsAction } from "./useSettingsAction";

type Labels = {
  title: string;
  intro: string;
  kept: string;
  cooling: string;
  password: string;
  code: string;
  understand: string;
  submit: string;
  fresh: string;
  reauth: string;
  cancel: string;
  cancelled: string;
  requested: string;
};

/**
 * Setări → Cont → „Șterge contul” (specul 2026-10-09-stergere-unire-membri §5). Fără cerere: explicația, parola (sau o
 * autentificare recentă, pentru conturile fără parolă), codul 2FA și confirmarea. Cu cerere: data ștergerii și „Anulează”.
 */
export function GcsDeleteAccount({
  pending,
  hasPassword,
  twoFactor,
  fresh,
  labels,
}: {
  /** Textul cererii în așteptare („Contul tău va fi șters pe …”), dacă există. */
  pending: string | null;
  hasPassword: boolean;
  twoFactor: boolean;
  /** Contul fără parolă s-a autentificat în ultimele 15 minute. */
  fresh: boolean;
  labels: Labels;
}) {
  const router = useRouter();
  const request = useSettingsAction(labels.requested);
  const cancel = useSettingsAction(labels.cancelled);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState(false);

  async function reauth() {
    rememberAuthReturn();
    await authClient.signOut();
    router.push("/login");
  }

  return (
    <section className="gcs-settingsFieldset gcs-settingsDanger" aria-labelledby="gcs-delete-account" data-testid="gcs-delete-account">
      <h2 className="gcs-settingsTitle" id="gcs-delete-account">
        <GcsIconSvg icon={faUserXmark} className="gcs-hIcon" />
        {labels.title}
      </h2>
      {pending ? (
        <>
          <p role="status" className="gcs-notice gcs-notice--warn" data-testid="gcs-delete-account-pending">
            {pending}
          </p>
          <div>
            <GcsButton variant="primary" icon={<GcsIconSvg icon={faRotateLeft} />} disabled={cancel.pending} onClick={() => cancel.run(() => cancelAccountDeletion({}))}>
              {labels.cancel}
            </GcsButton>
          </div>
          <GcsStatus status={cancel.status} />
        </>
      ) : (
        <form
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            request.run(() => requestAccountDeletion({ password, code, confirm }), () => {
              setPassword("");
              setCode("");
            });
          }}
        >
          <p className="gcs-muted" style={{ margin: 0 }}>
            {labels.intro}
          </p>
          <p className="gcs-muted" style={{ margin: 0 }}>
            {labels.kept} {labels.cooling}
          </p>
          {!hasPassword && !fresh ? (
            <>
              <p className="gcs-notice gcs-notice--warn" style={{ margin: 0 }} data-testid="gcs-delete-account-reauth">
                {labels.fresh}
              </p>
              <div>
                <GcsButton variant="ghost" icon={<GcsIconSvg icon={faRightToBracket} />} onClick={() => void reauth()}>
                  {labels.reauth}
                </GcsButton>
              </div>
            </>
          ) : (
            <>
              {hasPassword && (
                <div className="gcs-field">
                  <label htmlFor="delete-password">{labels.password}</label>
                  <input id="delete-password" type="password" autoComplete="current-password" className="gcs-input" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
              )}
              {twoFactor && (
                <div className="gcs-field">
                  <label htmlFor="delete-code">{labels.code}</label>
                  <input id="delete-code" inputMode="numeric" autoComplete="one-time-code" className="gcs-input" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={10} />
                </div>
              )}
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14 }}>
                <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} required style={{ marginTop: 3 }} />
                {labels.understand}
              </label>
              <div>
                <GcsButton type="submit" variant="primary" icon={<GcsIconSvg icon={faUserXmark} />} disabled={request.pending}>
                  {labels.submit}
                </GcsButton>
              </div>
            </>
          )}
          <GcsStatus status={request.status} />
        </form>
      )}
    </section>
  );
}
