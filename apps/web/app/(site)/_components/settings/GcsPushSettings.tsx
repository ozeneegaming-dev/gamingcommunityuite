"use client";

import { faBell, faBellSlash, faCircleCheck, faCircleXmark, faLaptop, faMobileScreen, faTrash, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import type { GcsPushDevice } from "@gcs/core";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { subscribePush, unsubscribePush } from "../../notification-actions";

/** Starea web push pe acest browser: nesuportat, permisiunea (încă necerută / dată / refuzată) și abonamentul lui. */
type PushState = "loading" | "unsupported" | "default" | "denied" | "granted";

const SW_URL = "/sw.js";

/** Cheia publică VAPID (base64url) ca octeți, pentru `pushManager.subscribe`. */
function keyBytes(base64url: string): Uint8Array {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/**
 * Web push în Setări → Notificări (Notificări v2): starea permisiunii pe acest browser, butonul care cere permisiunea
 * (doar la click, niciodată la încărcarea paginii), abonarea acestui dispozitiv (service worker-ul `/sw.js`) și lista
 * dispozitivelor abonate, fiecare cu butonul de ștergere. Ce notificări pleacă pe push se alege în tabelul de mai jos.
 */
export function GcsPushSettings({ publicKey, devices }: { publicKey: string | null; devices: GcsPushDevice[] }) {
  const t = useTranslations("settings.notifications.push");
  const format = useFormatter();
  const router = useRouter();
  const message = useErrorMessage();
  const [state, setState] = useState<PushState>("loading");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const refresh = useCallback(async () => {
    if (!supported()) return setState("unsupported");
    setState(Notification.permission === "granted" ? "granted" : Notification.permission === "denied" ? "denied" : "default");
    try {
      const reg = await navigator.serviceWorker.getRegistration(SW_URL);
      const sub = await reg?.pushManager.getSubscription();
      setEndpoint(sub?.endpoint ?? null);
    } catch {
      setEndpoint(null);
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);

  const enable = () =>
    start(async () => {
      setError(null);
      if (!publicKey || !supported()) return;
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState(permission === "denied" ? "denied" : "default");
          return;
        }
        const reg = await navigator.serviceWorker.register(SW_URL, { scope: "/" });
        await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
        const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
        const res = await subscribePush({ endpoint: json.endpoint ?? sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" }, userAgent: navigator.userAgent });
        if (!res.ok) {
          setError(message(res.error));
          await sub.unsubscribe().catch(() => false);
          return;
        }
        setEndpoint(sub.endpoint);
        setState("granted");
        router.refresh();
      } catch {
        setError(t("failed"));
      }
    });

  const disableHere = () =>
    start(async () => {
      setError(null);
      try {
        const reg = await navigator.serviceWorker.getRegistration(SW_URL);
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          await unsubscribePush({ endpoint: sub.endpoint });
          await sub.unsubscribe().catch(() => false);
        }
        setEndpoint(null);
        router.refresh();
      } catch {
        setError(t("failed"));
      }
    });

  const isThis = (d: GcsPushDevice) => !!endpoint && endpoint.slice(-16) === d.tail;
  const remove = (d: GcsPushDevice) =>
    start(async () => {
      await unsubscribePush({ id: d.id });
      // Dispozitivul scos e chiar acest browser: și abonamentul lui local pleacă.
      if (isThis(d)) {
        try {
          const reg = await navigator.serviceWorker.getRegistration(SW_URL);
          await (await reg?.pushManager.getSubscription())?.unsubscribe();
        } catch {
          // Abonamentul local rămâne; serverul nu-i mai trimite nimic.
        }
        setEndpoint(null);
      }
      router.refresh();
    });

  const stateText: Record<PushState, string> = {
    loading: t("state.loading"),
    unsupported: t("state.unsupported"),
    default: t("state.default"),
    denied: t("state.denied"),
    granted: endpoint ? t("state.subscribed") : t("state.granted"),
  };
  const stateIcon = state === "granted" && endpoint ? faCircleCheck : state === "denied" || state === "unsupported" ? faCircleXmark : faBell;

  return (
    <section className="gcs-settingsForm gcs-pushCard" aria-labelledby="gcs-push-title" data-testid="gcs-push-settings">
      <h3 id="gcs-push-title" className="gcs-pushCard__title">
        <GcsIconSvg icon={faBell} className="gcs-hIcon" />
        {t("title")}
      </h3>
      <p className="gcs-field__hint">{t("hint")}</p>
      <p className={`gcs-pushCard__state gcs-pushCard__state--${state}${endpoint ? " gcs-pushCard__state--on" : ""}`} data-testid="gcs-push-state" data-state={state === "granted" && endpoint ? "subscribed" : state}>
        <GcsIconSvg icon={stateIcon} />
        {stateText[state]}
      </p>
      {!publicKey ? (
        <p className="gcs-notice" data-testid="gcs-push-unavailable">
          {t("unavailable")}
        </p>
      ) : state === "unsupported" ? null : (
        <div className="gcs-pushCard__actions">
          {!endpoint && state !== "denied" && (
            <GcsButton variant="primary" icon={<GcsIconSvg icon={faBell} />} disabled={pending || state === "loading"} onClick={enable} data-testid="gcs-push-enable">
              {t("enable")}
            </GcsButton>
          )}
          {endpoint && (
            <GcsButton variant="ghost" icon={<GcsIconSvg icon={faBellSlash} />} disabled={pending} onClick={disableHere} data-testid="gcs-push-disable">
              {t("disable")}
            </GcsButton>
          )}
          {state === "denied" && <p className="gcs-field__hint">{t("deniedHelp")}</p>}
        </div>
      )}
      {error && (
        <p className="gcs-notice gcs-notice--error" role="alert">
          <GcsIconSvg icon={faTriangleExclamation} /> {error}
        </p>
      )}
      <h4 className="gcs-pushCard__subtitle">{t("devices", { count: devices.length })}</h4>
      {devices.length === 0 ? (
        <p className="gcs-field__hint" data-testid="gcs-push-no-devices">
          {t("noDevices")}
        </p>
      ) : (
        <ul className="gcs-pushCard__devices" data-testid="gcs-push-devices">
          {devices.map((d) => {
            const mobile = /mobile|android|iphone|ipad/i.test(d.userAgent);
            return (
              <li key={d.id} className="gcs-pushCard__device" data-testid="gcs-push-device">
                <GcsIconSvg icon={mobile ? faMobileScreen : faLaptop} className="gcs-pushCard__deviceIcon" />
                <span className="gcs-pushCard__deviceText">
                  <strong>
                    {browserName(d.userAgent) || d.host}
                    {isThis(d) && <span className="gcs-pushCard__this"> · {t("thisDevice")}</span>}
                  </strong>
                  <span className="gcs-pushCard__deviceMeta">
                    {t("since", { date: format.dateTime(new Date(d.createdAt), { dateStyle: "medium" }) })}
                    {d.lastUsedAt && ` · ${t("lastUsed", { date: format.relativeTime(new Date(d.lastUsedAt)) })}`}
                  </span>
                </span>
                <button type="button" className="gcs-iconBtn gcs-pushCard__remove" aria-label={t("remove")} title={t("remove")} disabled={pending} onClick={() => remove(d)} data-testid="gcs-push-device-remove">
                  <GcsIconSvg icon={faTrash} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Un nume scurt pentru browser și sistem, din user agent (ex. „Chrome · Windows”). */
function browserName(ua: string): string {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return [browser, os].filter(Boolean).join(" · ");
}
