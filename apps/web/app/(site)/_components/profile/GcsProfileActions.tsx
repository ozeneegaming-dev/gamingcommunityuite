"use client";

import type { GcsResult } from "@gcs/core";
import { faBan, faEllipsis, faEnvelope, faScrewdriverWrench, faUserCheck, faUserMinus, faUserPlus } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { followUser, ignoreUser } from "../../profile-actions";

type Props = {
  userId: string;
  isFollowing: boolean;
  isIgnored: boolean;
  canFollow: boolean;
  canMessage: boolean;
  canIgnore: boolean;
  acpHref: string | null;
  labels: { follow: string; unfollow: string; message: string; more: string; ignore: string; unignore: string; editAcp: string };
};

/** Butoanele de pe profil (macheta Profil): Urmărește, Mesaj și meniul „···” (Ignoră, Editează în ACP). */
export function GcsProfileActions({ userId, isFollowing, isIgnored, canFollow, canMessage, canIgnore, acpHref, labels }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [following, setFollowing] = useState(isFollowing);
  const [error, setError] = useState<string | null>(null);
  const message = useErrorMessage();

  const run = (fn: () => Promise<GcsResult<unknown>>, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(message(res.error));
        return;
      }
      setError(null);
      after?.();
      router.refresh();
    });

  return (
    <div className="gcs-profileHeader__actions">
      {canFollow && (
        <GcsButton
          variant={following ? "ghost" : "primary"}
          icon={<GcsIconSvg icon={following ? faUserMinus : faUserPlus} />}
          disabled={pending}
          data-testid="gcs-profile-follow"
          onClick={() => run(() => followUser({ userId, follow: !following }), () => setFollowing(!following))}
        >
          {following ? labels.unfollow : labels.follow}
        </GcsButton>
      )}
      {canMessage && (
        <GcsButton variant="ghost" asChild icon={<GcsIconSvg icon={faEnvelope} />}>
          <Link href={`/messages/new?to=${encodeURIComponent(userId)}`} data-testid="gcs-profile-message">
            {labels.message}
          </Link>
        </GcsButton>
      )}
      {(canIgnore || acpHref) && (
        <details className="gcs-menu">
          <summary className="gcs-btn gcs-btn--ghost gcs-menu__toggle" aria-label={labels.more}>
            <GcsIconSvg icon={faEllipsis} />
          </summary>
          <div className="gcs-menu__list" role="menu">
            {canIgnore && (
              <button
                type="button"
                role="menuitem"
                className="gcs-menu__item"
                disabled={pending}
                data-testid="gcs-profile-ignore"
                onClick={() => run(() => ignoreUser({ userId, posts: !isIgnored, messages: !isIgnored }))}
              >
                <GcsIconSvg icon={isIgnored ? faUserCheck : faBan} className="gcs-menu__icon" />
                {isIgnored ? labels.unignore : labels.ignore}
              </button>
            )}
            {acpHref && (
              <a role="menuitem" className="gcs-menu__item" href={acpHref}>
                <GcsIconSvg icon={faScrewdriverWrench} className="gcs-menu__icon" />
                {labels.editAcp}
              </a>
            )}
          </div>
        </details>
      )}
      {error && (
        <span role="alert" className="gcs-formError">
          {error}
        </span>
      )}
    </div>
  );
}
