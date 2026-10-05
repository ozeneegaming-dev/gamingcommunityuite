import type { GcsActionStatus } from "./useSettingsAction";

/** Mesajul după salvare: verde la succes, roșu la eroare (anunțat cititoarelor de ecran). */
export function GcsStatus({ status }: { status: GcsActionStatus }) {
  if (!status) return null;
  return (
    <p role={status.ok ? "status" : "alert"} className={`gcs-notice ${status.ok ? "gcs-notice--ok" : "gcs-notice--error"}`} data-testid="gcs-settings-status">
      {status.text}
    </p>
  );
}
