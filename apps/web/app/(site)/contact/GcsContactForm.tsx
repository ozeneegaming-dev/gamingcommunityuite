"use client";

import { faPaperPlane } from "@fortawesome/free-solid-svg-icons";
import { solvePowInBrowser, type GcsPowChallenge } from "@gcs/core/pow";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { sendContactAction } from "../contact-actions";

async function solveChallenge(signal: AbortSignal): Promise<string> {
  const res = await fetch("/api/antispam/pow", { cache: "no-store", signal });
  if (!res.ok) throw new Error("pow");
  return solvePowInBrowser((await res.json()) as GcsPowChallenge, signal);
}

/**
 * Formularul de contact: numele și emailul (doar pentru vizitatori; membrii le au din cont), subiectul (lista din ACP
 * sau text liber), mesajul. Pentru vizitatori, captcha-ul proof-of-work se rezolvă în fundal cât completează.
 */
export function GcsContactForm({ subjects, member, pow }: { subjects: string[]; member: { name: string; email: string | null } | null; pow: boolean }) {
  const t = useTranslations("contact");
  const errorMessage = useErrorMessage();
  const powRef = useRef<Promise<string> | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const startPow = () => {
    const ctl = new AbortController();
    powRef.current = solveChallenge(ctl.signal);
    powRef.current.catch(() => {});
    return ctl;
  };
  useEffect(() => {
    if (!pow) return;
    const ctl = startPow();
    return () => ctl.abort();
  }, [pow]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    let token: string | null = null;
    if (pow) {
      if (!powRef.current) startPow();
      token = await powRef.current!.catch(() => null);
    }
    const result = await sendContactAction({
      name: String(fd.get("name") ?? ""),
      email: String(fd.get("email") ?? ""),
      subject: String(fd.get("subject") ?? ""),
      body: String(fd.get("body") ?? ""),
      pow: token,
    });
    setPending(false);
    if (!result.ok) {
      // Un token de captcha se folosește o singură dată: următoarea încercare primește unul nou.
      if (pow) startPow();
      return setError(errorMessage(result.error));
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="gcs-contact__sent" role="status" data-testid="gcs-contact-sent">
        <strong>{t("sentTitle")}</strong>
        <span>{t("sentBody")}</span>
      </div>
    );
  }
  return (
    <form className="gcs-contact__form" onSubmit={onSubmit} data-testid="gcs-contact-form">
      {member?.email ? (
        <p className="gcs-muted gcs-contact__as">{t("as", { name: member.name, email: member.email })}</p>
      ) : member ? (
        <label className="gcs-field">
          {t("email")}
          <input className="gcs-input" name="email" type="email" required maxLength={190} autoComplete="email" />
        </label>
      ) : (
        <div className="gcs-formGrid gcs-formGrid--2">
          <label className="gcs-field">
            {t("name")}
            <input className="gcs-input" name="name" required minLength={2} maxLength={60} autoComplete="name" />
          </label>
          <label className="gcs-field">
            {t("email")}
            <input className="gcs-input" name="email" type="email" required maxLength={190} autoComplete="email" />
          </label>
        </div>
      )}
      <label className="gcs-field">
        {t("subject")}
        {subjects.length > 0 ? (
          <select className="gcs-input" name="subject" required defaultValue="">
            <option value="" disabled>
              {t("pickSubject")}
            </option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <input className="gcs-input" name="subject" required minLength={3} maxLength={120} />
        )}
      </label>
      <label className="gcs-field">
        {t("message")}
        <textarea className="gcs-input" name="body" required minLength={10} maxLength={5000} rows={8} />
      </label>
      <div className="gcs-contact__actions">
        <GcsButton variant="primary" type="submit" disabled={pending} icon={<GcsIconSvg icon={faPaperPlane} />}>
          {pending ? t("sending") : t("send")}
        </GcsButton>
        {error && (
          <span role="alert" className="gcs-contact__error">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
