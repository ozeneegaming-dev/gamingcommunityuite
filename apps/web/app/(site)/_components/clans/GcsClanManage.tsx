"use client";

import { faArrowDown, faArrowUp, faBan, faCheck, faComments, faCrown, faPaperPlane, faPlus, faRotateLeft, faTrash, faUserMinus, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { GcsResult } from "@gcs/core";
import { GcsButton, GcsIconSvg, GcsMemberName } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { cancelClanInvite, createClanForum, decideClanRequest, disbandClan, inviteToClan, kickFromClan, reactivateClan, setClanRole, transferClan } from "../../clan-actions";

/** O acțiune din administrare: eroarea apare lângă buton, succesul reîncarcă pagina (și, opțional, un mesaj). */
function useRun() {
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<GcsResult<unknown>>, okText?: string, after?: () => void) =>
    start(async () => {
      setStatus(null);
      const res = await fn();
      if (!res.ok) return setStatus({ ok: false, text: errorMessage(res.error) });
      if (okText) setStatus({ ok: true, text: okText });
      after?.();
      router.refresh();
    });
  const message = status ? (
    <span role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-clanForm__ok" : "gcs-formError"}>
      {status.text}
    </span>
  ) : null;
  return { pending, run, message };
}

export type GcsManageMember = { userId: string; name: string; role: "LEADER" | "OFFICER" | "MEMBER"; joined: string; link: ReactNode };

/**
 * Tab-ul „Membri”: rolurile, numirea / retrogradarea ofițerilor (liderul) și excluderea (liderul; ofițerii cu dreptul
 * `members` doar pe membrii simpli). Liderul nu are acțiuni pe rândul lui.
 */
export function GcsClanMembersTable({
  clanId,
  members,
  canLead,
  canKick,
  steam = null,
}: {
  clanId: number;
  members: GcsManageMember[];
  canLead: boolean;
  canKick: boolean;
  /** Cine are Steam conectat (statisticile de joc ale aplicației Servere); `null` = coloana nu apare. */
  steam?: Record<string, boolean> | null;
}) {
  const t = useTranslations("clans.manage");
  const tr = useTranslations("clans.roles");
  const { pending, run, message } = useRun();
  return (
    <>
      <table className="gcs-clanManage__table" data-testid="gcs-clan-manage-members">
        <thead>
          <tr>
            <th scope="col">{t("member")}</th>
            <th scope="col">{t("role")}</th>
            <th scope="col">{t("joined")}</th>
            {steam && <th scope="col">{t("steam")}</th>}
            <th scope="col">
              <span className="gcs-srOnly">{t("actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.userId} data-testid="gcs-clan-manage-member" data-name={m.name}>
              <td>
                <span className="gcs-clanManage__who">{m.link}</span>
              </td>
              <td data-testid="gcs-clan-member-role">{tr(m.role)}</td>
              <td className="gcs-muted">{m.joined}</td>
              {steam && (
                <td data-testid="gcs-clan-member-steam" className={steam[m.userId] ? undefined : "gcs-muted"}>
                  {steam[m.userId] ? t("steamLinked") : t("steamMissing")}
                </td>
              )}
              <td className="gcs-clanManage__cell--actions">
                {m.role !== "LEADER" && (
                  <div className="gcs-clanManage__actions">
                    {canLead &&
                      (m.role === "MEMBER" ? (
                        <GcsButton size="sm" variant="ghost" icon={<GcsIconSvg icon={faArrowUp} />} disabled={pending} onClick={() => run(() => setClanRole({ clanId, userId: m.userId, role: "OFFICER" }))}>
                          {t("promote")}
                        </GcsButton>
                      ) : (
                        <GcsButton size="sm" variant="ghost" icon={<GcsIconSvg icon={faArrowDown} />} disabled={pending} onClick={() => run(() => setClanRole({ clanId, userId: m.userId, role: "MEMBER" }))}>
                          {t("demote")}
                        </GcsButton>
                      ))}
                    {canKick && (canLead || m.role === "MEMBER") && (
                      <GcsButton
                        size="sm"
                        variant="ghost"
                        icon={<GcsIconSvg icon={faUserMinus} />}
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm(t("kickConfirm", { name: m.name }))) run(() => kickFromClan({ clanId, userId: m.userId }));
                        }}
                      >
                        {t("kick")}
                      </GcsButton>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {message}
    </>
  );
}

export type GcsManageRequest = { id: number; name: string; message: string; meta: ReactNode; link: ReactNode };

/** Cererile de intrare în așteptare: acceptă / refuză. */
export function GcsClanRequestList({ requests }: { requests: GcsManageRequest[] }) {
  const t = useTranslations("clans.manage");
  const { pending, run, message } = useRun();
  if (requests.length === 0) return <p className="gcs-muted" style={{ margin: 0 }}>{t("noRequests")}</p>;
  return (
    <div data-testid="gcs-clan-requests">
      {requests.map((r) => (
        <div key={r.id} className="gcs-clanRequest" data-testid="gcs-clan-request-row" data-name={r.name}>
          <div className="gcs-clanRequest__body">
            <span className="gcs-clanManage__who">{r.link}</span>
            {r.message && <p className="gcs-clanRequest__message">{r.message}</p>}
            <span className="gcs-clanRequest__meta">{r.meta}</span>
          </div>
          <div className="gcs-clanManage__actions">
            <GcsButton size="sm" variant="primary" icon={<GcsIconSvg icon={faCheck} />} disabled={pending} onClick={() => run(() => decideClanRequest({ requestId: r.id, accept: true }))} data-testid="gcs-clan-request-accept">
              {t("accept")}
            </GcsButton>
            <GcsButton size="sm" variant="ghost" icon={<GcsIconSvg icon={faBan} />} disabled={pending} onClick={() => run(() => decideClanRequest({ requestId: r.id, accept: false }))}>
              {t("reject")}
            </GcsButton>
          </div>
        </div>
      ))}
      {message}
    </div>
  );
}

/** Invitațiile trimise (cu „Anulează”) și formularul de invitație, cu căutarea membrilor după nume. */
export function GcsClanInvites({ clanId, invites }: { clanId: number; invites: GcsManageRequest[] }) {
  const t = useTranslations("clans.manage");
  const { pending, run, message } = useRun();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ id: string; name: string; nameKey?: string | null }[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setFound([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/forums/mentions?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((r) => (r.ok ? (r.json() as Promise<{ users: { id: string; name: string; nameKey?: string | null }[] }>) : { users: [] }))
        .then((d) => setFound(d.users))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const invite = (name: string) => run(() => inviteToClan({ clanId, name }), t("invited", { name }), () => {
    setQuery("");
    setFound([]);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <form
        style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) invite(query.trim());
        }}
      >
        <label className="gcs-field" style={{ flex: "1 1 220px" }}>
          {t("inviteLabel")}
          <input className="gcs-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("invitePlaceholder")} autoComplete="off" maxLength={40} data-testid="gcs-clan-invite-name" />
        </label>
        <GcsButton type="submit" variant="primary" icon={<GcsIconSvg icon={faPaperPlane} />} disabled={pending || !query.trim()} data-testid="gcs-clan-invite-send">
          {t("invite")}
        </GcsButton>
      </form>
      {found.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: 6 }} aria-label={t("inviteSuggestions")}>
          {found.map((u) => (
            <li key={u.id}>
              <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" onClick={() => setQuery(u.name)}>
                <GcsIconSvg icon={faPlus} />
                <GcsMemberName userId={u.id} name={u.name} nameKey={u.nameKey ?? null} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {message}
      {invites.length === 0 ? (
        <p className="gcs-muted" style={{ margin: 0 }}>
          {t("noInvites")}
        </p>
      ) : (
        <div data-testid="gcs-clan-invites-sent">
          {invites.map((r) => (
            <div key={r.id} className="gcs-clanRequest">
              <div className="gcs-clanRequest__body">
                <span className="gcs-clanManage__who">{r.link}</span>
                <span className="gcs-clanRequest__meta">{r.meta}</span>
              </div>
              <GcsButton size="sm" variant="ghost" icon={<GcsIconSvg icon={faXmark} />} disabled={pending} onClick={() => run(() => cancelClanInvite({ inviteId: r.id }))}>
                {t("cancelInvite")}
              </GcsButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** „Creează forumul clanului” (liderul sau staff-ul, când opțiunile o permit). */
export function GcsClanForumButton({ clanId, ready }: { clanId: number; ready: boolean }) {
  const t = useTranslations("clans.manage");
  const { pending, run, message } = useRun();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
      <GcsButton variant="ghost" icon={<GcsIconSvg icon={faComments} />} disabled={pending || !ready} onClick={() => run(() => createClanForum({ clanId }), t("forumCreated"))} data-testid="gcs-clan-create-forum">
        {t("createForum")}
      </GcsButton>
      {!ready && <span className="gcs-field__hint">{t("forumNotReady")}</span>}
      {message}
    </div>
  );
}

/**
 * „Zona periculoasă”: transferul conducerii (un membru din listă, cu confirmare), desființarea (scriind tagul) și
 * reactivarea unui clan arhivat.
 */
export function GcsClanDangerZone({
  clanId,
  tag,
  candidates,
  canTransfer,
  canDisband,
  archived,
  staff,
}: {
  clanId: number;
  tag: string;
  candidates: { userId: string; name: string }[];
  canTransfer: boolean;
  canDisband: boolean;
  archived: boolean;
  staff: boolean;
}) {
  const t = useTranslations("clans.manage");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const { pending, run, message } = useRun();
  const [target, setTarget] = useState(candidates[0]?.userId ?? "");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {archived && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <p style={{ margin: 0, flex: "1 1 260px" }}>{t("reactivateText")}</p>
          <GcsButton variant="primary" icon={<GcsIconSvg icon={faRotateLeft} />} disabled={pending} onClick={() => run(() => reactivateClan({ clanId }), t("reactivated"))}>
            {t("reactivate")}
          </GcsButton>
        </div>
      )}
      {canTransfer && (
        <form
          style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}
          onSubmit={(e) => {
            e.preventDefault();
            const name = candidates.find((c) => c.userId === target)?.name ?? "";
            if (target && window.confirm(t("transferConfirm", { name }))) run(() => transferClan({ clanId, userId: target }), t("transferred", { name }));
          }}
        >
          <label className="gcs-field" style={{ flex: "1 1 220px" }}>
            {t("transferLabel")}
            <select className="gcs-input" value={target} onChange={(e) => setTarget(e.target.value)} disabled={candidates.length === 0} data-testid="gcs-clan-transfer-select">
              {candidates.length === 0 && <option value="">{t("transferNone")}</option>}
              {candidates.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <GcsButton type="submit" variant="ghost" icon={<GcsIconSvg icon={faCrown} />} disabled={pending || !target}>
            {t("transfer")}
          </GcsButton>
        </form>
      )}
      {canDisband && (
        <form
          className="gcs-clanDanger"
          style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            const res = await disbandClan({ clanId, confirm });
            if (!res.ok) return setError(errorMessage(res.error));
            router.push("/clans");
          }}
        >
          <label className="gcs-field" style={{ flex: "1 1 220px" }}>
            {staff ? t("disbandStaff") : t("disbandLabel", { tag })}
            {!staff && <input className="gcs-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" data-testid="gcs-clan-disband-confirm" />}
          </label>
          <GcsButton type="submit" variant="primary" icon={<GcsIconSvg icon={faTrash} />} disabled={!staff && confirm.trim() === ""} data-testid="gcs-clan-disband">
            {t("disband")}
          </GcsButton>
          {error && (
            <span role="alert" className="gcs-formError" style={{ flexBasis: "100%" }}>
              {error}
            </span>
          )}
        </form>
      )}
      {message}
    </div>
  );
}
