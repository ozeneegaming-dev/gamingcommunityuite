"use client";

import { faChevronDown, faGear, faRightFromBracket, faUser } from "@fortawesome/free-solid-svg-icons";
import { GcsDropdown, GcsIconSvg } from "@gcs/ui";
import { useTransition, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";

type Props = {
  /** Avatarul și numele adminului (randate pe server). */
  trigger: ReactNode;
  profileHref: string;
  labels: { menu: string; profile: string; settings: string; logout: string };
};

/** Meniul contului din bara de sus a ACP-ului: profilul, setările contului și ieșirea. */
export function GcsAcpAccountMenu({ trigger, profileHref, labels }: Props) {
  const [, start] = useTransition();
  return (
    <GcsDropdown
      label={labels.menu}
      testId="gcs-acp-account"
      triggerClassName="gcs-acpTop__account"
      trigger={
        <>
          {trigger}
          <GcsIconSvg icon={faChevronDown} className="gcs-acpTop__caret" />
        </>
      }
      items={[
        { kind: "link", label: labels.profile, href: profileHref, icon: <GcsIconSvg icon={faUser} />, testId: "gcs-acp-account-profile" },
        { kind: "link", label: labels.settings, href: "/settings/profile", icon: <GcsIconSvg icon={faGear} />, testId: "gcs-acp-account-settings" },
        { kind: "separator" },
        {
          kind: "action",
          label: labels.logout,
          icon: <GcsIconSvg icon={faRightFromBracket} />,
          testId: "gcs-acp-account-logout",
          onSelect: () =>
            start(async () => {
              await authClient.signOut();
              // Navigare completă: toată pagina se randează din nou, fără sesiune.
              window.location.assign("/");
            }),
        },
      ]}
    />
  );
}
