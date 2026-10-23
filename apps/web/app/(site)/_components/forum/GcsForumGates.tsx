"use client";

import { faCheck, faKey, faLock } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { acceptForumRulesAction, unlockForumAction } from "../../forum-v2-actions";

/** Parola unui forum (Forum v2): formularul care deblochează forumul în acest browser (30 de zile). */
export function GcsForumPasswordForm({ forumId, name }: { forumId: number; name: string }) {
  const t = useTranslations("forum.password");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="gcs-card gcs-forumGate" aria-labelledby="gcs-forum-gate-title" data-testid="gcs-forum-password">
      <h2 id="gcs-forum-gate-title" className="gcs-display gcs-forumGate__title">
        <GcsIconSvg icon={faLock} className="gcs-hIcon" />
        {t("title", { name })}
      </h2>
      <p className="gcs-muted">{t("hint")}</p>
      <form
        className="gcs-forumGate__form"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const res = await unlockForumAction({ forumId, password });
            if (!res.ok) return setError(errorMessage(res.error));
            router.refresh();
          });
        }}
      >
        <label className="gcs-srOnly" htmlFor="gcs-forum-password">
          {t("label")}
        </label>
        <input id="gcs-forum-password" className="gcs-input" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("label")} required maxLength={100} />
        <GcsButton variant="primary" type="submit" loading={pending} icon={<GcsIconSvg icon={faKey} />}>
          {t("submit")}
        </GcsButton>
      </form>
      {error && (
        <p role="alert" className="gcs-notice gcs-notice--error">
          {error}
        </p>
      )}
    </section>
  );
}

/** „Am citit și accept regulile” (forumurile cu regulile de acceptat înainte de a posta). */
export function GcsAcceptRulesButton({ forumId }: { forumId: number }) {
  const t = useTranslations("forum.rules");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <GcsButton
        variant="primary"
        size="sm"
        loading={pending}
        icon={<GcsIconSvg icon={faCheck} />}
        onClick={() =>
          start(async () => {
            const res = await acceptForumRulesAction({ forumId });
            if (!res.ok) return setError(errorMessage(res.error));
            router.refresh();
          })
        }
        data-testid="gcs-forum-rules-accept"
      >
        {t("accept")}
      </GcsButton>
      {error && (
        <p role="alert" className="gcs-notice gcs-notice--error">
          {error}
        </p>
      )}
    </>
  );
}
