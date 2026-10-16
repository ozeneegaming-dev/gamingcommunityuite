"use client";

import { faRightFromBracket, faRightToBracket } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { toggleOptInGroup } from "../../settings-actions";

export type GcsOptInRow = { id: number; name: string; joined: boolean; canLeave: boolean; primary: boolean; pill: ReactNode };

/**
 * Setări → Grupuri (Membri v2): grupurile publice, cu „Intră” / „Ieși”. Un grup dat de staff sau de o aplicație nu se
 * poate părăsi de aici; grupul principal nu se schimbă.
 */
export function GcsOptInGroups({ groups }: { groups: GcsOptInRow[] }) {
  const t = useTranslations("settings.groups");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, setPending] = useState<number | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function toggle(g: GcsOptInRow) {
    setPending(g.id);
    setStatus(null);
    const res = await toggleOptInGroup({ groupId: g.id, join: !g.joined });
    setPending(null);
    if (!res.ok) return setStatus({ ok: false, text: errorMessage(res.error) });
    setStatus({ ok: true, text: g.joined ? t("left", { group: g.name }) : t("joined", { group: g.name }) });
    router.refresh();
  }

  return (
    <div className="gcs-optIn">
      <ul className="gcs-optIn__list">
        {groups.map((g) => (
          <li key={g.id} className="gcs-optIn__row" data-testid="gcs-optin-group" data-group={g.name} data-joined={g.joined ? "1" : "0"}>
            <span className="gcs-optIn__pill">{g.pill}</span>
            <span className="gcs-optIn__state">{g.primary ? t("primary") : g.joined ? (g.canLeave ? t("member") : t("assigned")) : t("notMember")}</span>
            {!g.primary && (!g.joined || g.canLeave) && (
              <GcsButton
                variant={g.joined ? "ghost" : "primary"}
                size="sm"
                icon={<GcsIconSvg icon={g.joined ? faRightFromBracket : faRightToBracket} />}
                disabled={pending === g.id}
                onClick={() => void toggle(g)}
                data-testid={g.joined ? "gcs-optin-leave" : "gcs-optin-join"}
              >
                {g.joined ? t("leave") : t("join")}
              </GcsButton>
            )}
          </li>
        ))}
      </ul>
      {status && (
        <p role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-notice" : "gcs-notice gcs-notice--error"} data-testid="gcs-optin-status">
          {status.text}
        </p>
      )}
    </div>
  );
}
