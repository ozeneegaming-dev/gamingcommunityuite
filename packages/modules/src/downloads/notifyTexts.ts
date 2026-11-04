/** Textele notificărilor Descărcărilor (email și clopoțel), ca restul din `notifications/emails.ts`. */
type Locale = "ro" | "en";
type Text = (a: string, t: string, n: number, d: Record<string, unknown>, first: string) => string;

const reason = (d: Record<string, unknown>) => (typeof d.reason === "string" && d.reason ? `: ${d.reason}` : "");

const REVIEW: Record<Locale, (t: string, d: Record<string, unknown>) => string> = {
  ro: (t, d) =>
    d.kind === "approved"
      ? `Fișierul tău „${t}” a fost aprobat și e publicat`
      : d.kind === "blocked"
        ? `Fișierul „${String(d.title || t)}” a fost blocat de antivirus și pus în carantină`
        : `Fișierul tău „${String(d.title || t)}” a fost respins${reason(d)}`,
  en: (t, d) =>
    d.kind === "approved"
      ? `Your file “${t}” was approved and is now published`
      : d.kind === "blocked"
        ? `The file “${String(d.title || t)}” was blocked by the antivirus and quarantined`
        : `Your file “${String(d.title || t)}” was rejected${reason(d)}`,
};

export const DOWNLOAD_NOTIFICATION_TEXTS: Record<string, Record<Locale, Text>> = {
  "downloads.review": { ro: (_a, t, _n, d) => REVIEW.ro(t, d), en: (_a, t, _n, d) => REVIEW.en(t, d) },
  "downloads.version": {
    ro: (a, t, _n, d) => `${a} a publicat o versiune nouă${d.label ? ` (${String(d.label)})` : ""} pentru „${t}”`,
    en: (a, t, _n, d) => `${a} published a new version${d.label ? ` (${String(d.label)})` : ""} of “${t}”`,
  },
  "downloads.new_file": { ro: (a, t) => `${a} a publicat un fișier nou: „${t}”`, en: (a, t) => `${a} published a new file: “${t}”` },
  "downloads.feedback": {
    ro: (a, t, _n, d) => (d.kind === "review" ? `${a} a scris o recenzie la „${t}”` : `${a} a comentat la „${t}”`),
    en: (a, t, _n, d) => (d.kind === "review" ? `${a} reviewed “${t}”` : `${a} commented on “${t}”`),
  },
  "downloads.mention": { ro: (a, t) => `${a} te-a menționat la „${t}”`, en: (a, t) => `${a} mentioned you on “${t}”` },
  "downloads.queue": {
    ro: (a, _t, n, d) => (n > 1 ? `${n} fișiere noi așteaptă aprobarea în Descărcări` : `${a} a trimis „${String(d.title ?? "")}”: așteaptă aprobarea`),
    en: (a, _t, n, d) => (n > 1 ? `${n} new files are waiting for approval in Downloads` : `${a} submitted “${String(d.title ?? "")}”: waiting for approval`),
  },
  "downloads.infected": {
    ro: (_a, _t, _n, d) => `Antivirus: fișierul „${String(d.title ?? "")}” e infectat (${String(d.signature ?? "")}) și a fost pus în carantină`,
    en: (_a, _t, _n, d) => `Antivirus: the file “${String(d.title ?? "")}” is infected (${String(d.signature ?? "")}) and was quarantined`,
  },
};
