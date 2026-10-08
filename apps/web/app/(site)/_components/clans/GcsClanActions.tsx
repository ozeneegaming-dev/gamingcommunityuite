"use client";

import { faCheck, faDoorOpen, faEnvelopeOpenText, faPaperPlane, faRightFromBracket, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { GcsResult } from "@gcs/core";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition, type ReactNode } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { answerClanInvite, cancelClanRequest, joinClan, leaveClan, requestClan } from "../../clan-actions";

/** Rulează o acțiune a clanului: eroarea apare sub butoane, succesul reîncarcă datele paginii. */
function useClanAction() {
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<GcsResult<unknown>>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(errorMessage(res.error));
      after?.();
      router.refresh();
    });
  return { pending, error, run };
}

export type GcsClanViewerActions = {
  clanId: number;
  clanName: string;
  role: "LEADER" | "OFFICER" | "MEMBER" | null;
  joinMode: "OPEN" | "REQUEST" | "INVITE";
  canJoin: boolean;
  canRequest: boolean;
  pendingRequest: boolean;
  invite: { invitedBy: string | null } | null;
  blocked: "guest" | "no_permission" | "max_clans" | null;
  open: boolean;
};

/**
 * Acțiunile viewer-ului pe pagina clanului (specul 2026-10-08-clanuri §7.2): acceptă / refuză invitația, intră, cere
 * intrarea (cu un mesaj), retrage cererea, părăsește clanul; altfel, de ce nu poate intra.
 */
export function GcsClanJoinActions({ v }: { v: GcsClanViewerActions }) {
  const t = useTranslations("clans.actions");
  const { pending, error, run } = useClanAction();
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState("");

  let content: ReactNode = null;
  if (v.invite) {
    content = (
      <>
        <span className="gcs-muted" data-testid="gcs-clan-invited">
          {v.invite.invitedBy ? t("invitedBy", { name: v.invite.invitedBy }) : t("invited")}
        </span>
        <GcsButton variant="primary" icon={<GcsIconSvg icon={faCheck} />} disabled={pending} onClick={() => run(() => answerClanInvite({ clanId: v.clanId, accept: true }))} data-testid="gcs-clan-accept-invite">
          {t("acceptInvite")}
        </GcsButton>
        <GcsButton variant="ghost" icon={<GcsIconSvg icon={faXmark} />} disabled={pending} onClick={() => run(() => answerClanInvite({ clanId: v.clanId, accept: false }))}>
          {t("declineInvite")}
        </GcsButton>
      </>
    );
  } else if (v.role !== null) {
    content =
      v.role === "LEADER" ? null : (
        <GcsButton
          variant="ghost"
          icon={<GcsIconSvg icon={faRightFromBracket} />}
          disabled={pending}
          onClick={() => {
            if (window.confirm(t("leaveConfirm", { name: v.clanName }))) run(() => leaveClan({ clanId: v.clanId }));
          }}
          data-testid="gcs-clan-leave"
        >
          {t("leave")}
        </GcsButton>
      );
  } else if (v.canJoin) {
    content = (
      <GcsButton variant="primary" icon={<GcsIconSvg icon={faDoorOpen} />} disabled={pending} onClick={() => run(() => joinClan({ clanId: v.clanId }))} data-testid="gcs-clan-join">
        {t("join")}
      </GcsButton>
    );
  } else if (v.pendingRequest) {
    content = (
      <>
        <span className="gcs-muted" data-testid="gcs-clan-request-pending">
          {t("requestPending")}
        </span>
        <GcsButton variant="ghost" icon={<GcsIconSvg icon={faXmark} />} disabled={pending} onClick={() => run(() => cancelClanRequest({ clanId: v.clanId }))}>
          {t("cancelRequest")}
        </GcsButton>
      </>
    );
  } else if (v.canRequest) {
    content = asking ? (
      <form
        className="gcs-clanAsk"
        style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: "min(360px, 100%)" }}
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => requestClan({ clanId: v.clanId, message }),
            () => setAsking(false),
          );
        }}
      >
        <label className="gcs-field">
          {t("messageLabel")}
          <textarea className="gcs-input" rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("messagePlaceholder")} data-testid="gcs-clan-request-message" />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <GcsButton type="submit" variant="primary" icon={<GcsIconSvg icon={faPaperPlane} />} disabled={pending} data-testid="gcs-clan-request-send">
            {t("sendRequest")}
          </GcsButton>
          <GcsButton type="button" variant="ghost" onClick={() => setAsking(false)}>
            {t("cancel")}
          </GcsButton>
        </div>
      </form>
    ) : (
      <GcsButton variant="primary" icon={<GcsIconSvg icon={faEnvelopeOpenText} />} onClick={() => setAsking(true)} data-testid="gcs-clan-request">
        {t("request")}
      </GcsButton>
    );
  } else if (v.open && v.blocked) {
    content = <span className="gcs-muted">{t(`blocked.${v.blocked}`)}</span>;
  } else if (v.open && v.joinMode === "INVITE") {
    content = <span className="gcs-muted">{t("inviteOnly")}</span>;
  }

  if (!content && !error) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      {content}
      {error && (
        <span role="alert" className="gcs-formError" style={{ flexBasis: "100%" }}>
          {error}
        </span>
      )}
    </div>
  );
}

/** Acceptă / refuză o invitație din lista de pe director. */
export function GcsClanInviteButtons({ clanId }: { clanId: number }) {
  const t = useTranslations("clans.actions");
  const { pending, error, run } = useClanAction();
  return (
    <div className="gcs-clanInvite__actions">
      <GcsButton variant="primary" size="sm" icon={<GcsIconSvg icon={faCheck} />} disabled={pending} onClick={() => run(() => answerClanInvite({ clanId, accept: true }))} data-testid="gcs-clan-invite-accept">
        {t("acceptInvite")}
      </GcsButton>
      <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faXmark} />} disabled={pending} onClick={() => run(() => answerClanInvite({ clanId, accept: false }))}>
        {t("declineInvite")}
      </GcsButton>
      {error && (
        <span role="alert" className="gcs-formError">
          {error}
        </span>
      )}
    </div>
  );
}
