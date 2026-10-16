/**
 * Service worker-ul site-ului (Notificări v2, web push): afișează notificările push primite (titlul = site-ul, textul
 * notificării) și, la click, deschide sau aduce în față site-ul pe linkul notificării (doar pe aceeași origine). Se
 * înregistrează doar când membrul pornește web push din Setări → Notificări.
 */
const SCRIPT = `"use strict";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "GamingCommunitySuite";
  const options = {
    body: typeof data.body === "string" ? data.body : "",
    data: { url: typeof data.url === "string" ? data.url : "/notifications" },
  };
  if (typeof data.tag === "string" && data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  if (typeof data.icon === "string" && data.icon) options.icon = data.icon;
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "/notifications";
  const url = new URL(raw, self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          return client.focus().then((c) => (c && "navigate" in c ? c.navigate(url.href) : undefined));
        }
      }
      return self.clients.openWindow(url.href);
    }),
  );
});
`;

export const dynamic = "force-static";

export function GET() {
  return new Response(SCRIPT, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Browserul verifică des o versiune nouă a service worker-ului: fără cache îndelungat.
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
    },
  });
}
