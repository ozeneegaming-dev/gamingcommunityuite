/**
 * Canalele notificărilor (Notificări v2): pe site (clopoțelul), toast, email și web push. Fiecare tip are, pe fiecare canal,
 * una din trei stări: pornit, oprit sau „doar important” (doar notificările importante trec). Emailul are și modul lui:
 * imediat, digest zilnic sau digest săptămânal.
 *
 * Ordinea deciziei, pe canal: blocarea din ACP („forțat” = pornit, „dezactivat” = oprit) → alegerea membrului → valoarea
 * implicită din ACP → valoarea declarată de modul. Funcțiile de aici sunt pure (testate fără bază de date).
 */

export const GCS_NOTIFY_CHANNELS = ["site", "toast", "email", "push"] as const;
export type GcsNotifyChannel = (typeof GCS_NOTIFY_CHANNELS)[number];

export const GCS_CHANNEL_STATES = ["on", "important", "off"] as const;
export type GcsChannelState = (typeof GCS_CHANNEL_STATES)[number];

export const GCS_EMAIL_MODES = ["instant", "daily", "weekly"] as const;
export type GcsEmailMode = (typeof GCS_EMAIL_MODES)[number];

export const GCS_CHANNEL_LOCKS = ["forced", "disabled"] as const;
export type GcsChannelLock = (typeof GCS_CHANNEL_LOCKS)[number];

/** Starea fiecărui canal al unui tip, plus modul emailului. */
export type GcsTypeChannels = Record<GcsNotifyChannel, GcsChannelState> & { emailMode: GcsEmailMode };
/** Canalele blocate de ACP (lipsă = membrul alege). */
export type GcsChannelLocks = Partial<Record<GcsNotifyChannel, GcsChannelLock>>;
/** Valorile implicite ale unui tip (ACP), cu blocările. */
export type GcsTypeDefaults = GcsTypeChannels & { locks: GcsChannelLocks };
/** Ce a schimbat un membru față de valorile implicite (doar canalele alese explicit). */
export type GcsChannelOverride = Partial<GcsTypeChannels>;

/** Rezultatul pentru o notificare anume: pe ce canale pleacă (emailul cu modul lui, `null` = fără email). */
export type GcsDelivery = { site: boolean; toast: boolean; push: boolean; email: GcsEmailMode | null };

/** Forma veche (etapa 4): emailul implicit al unui tip. Tipurile noi pot declara direct `channels`. */
export type GcsLegacyEmail = "OFF" | "INSTANT" | "DIGEST";

const isState = (v: unknown): v is GcsChannelState => typeof v === "string" && (GCS_CHANNEL_STATES as readonly string[]).includes(v);
const isMode = (v: unknown): v is GcsEmailMode => typeof v === "string" && (GCS_EMAIL_MODES as readonly string[]).includes(v);
const isLock = (v: unknown): v is GcsChannelLock => typeof v === "string" && (GCS_CHANNEL_LOCKS as readonly string[]).includes(v);
const record = (raw: unknown): Record<string, unknown> => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {});

/**
 * Valorile declarate de modul pentru un tip: site și toast pornite, push „doar important”, emailul după `defaultEmail`
 * (oprit / imediat / digest zilnic); `channels` le poate înlocui pe oricare.
 */
export function codeChannels(def: { defaultEmail?: GcsLegacyEmail; channels?: Partial<GcsTypeChannels> }): GcsTypeChannels {
  const legacy = def.defaultEmail ?? "OFF";
  const base: GcsTypeChannels = {
    site: "on",
    toast: "on",
    email: legacy === "OFF" ? "off" : "on",
    push: "important",
    emailMode: legacy === "INSTANT" ? "instant" : "daily",
  };
  return { ...base, ...parseOverride(def.channels) };
}

/** Citește (validat) alegerile salvate ale unui membru sau ale ACP-ului; valorile necunoscute dispar. */
export function parseOverride(raw: unknown): GcsChannelOverride {
  const r = record(raw);
  const out: GcsChannelOverride = {};
  for (const ch of GCS_NOTIFY_CHANNELS) if (isState(r[ch])) out[ch] = r[ch];
  if (isMode(r.emailMode)) out.emailMode = r.emailMode;
  return out;
}

/** Citește (validat) blocările salvate de ACP. */
export function parseLocks(raw: unknown): GcsChannelLocks {
  const r = record(raw);
  const out: GcsChannelLocks = {};
  for (const ch of GCS_NOTIFY_CHANNELS) if (isLock(r[ch])) out[ch] = r[ch];
  return out;
}

/** Valorile implicite ale unui tip: cele din cod, peste care vin cele salvate în ACP. */
export function typeDefaults(code: GcsTypeChannels, saved?: { channels?: unknown; locks?: unknown } | null): GcsTypeDefaults {
  return { ...code, ...parseOverride(saved?.channels), locks: parseLocks(saved?.locks) };
}

/** Stările efective ale unui membru: blocările ACP, apoi alegerile lui, apoi valorile implicite. */
export function effectiveChannels(defaults: GcsTypeDefaults, override?: GcsChannelOverride | null): GcsTypeChannels {
  const out = { ...defaults, ...(override ? parseOverride(override) : {}) } as GcsTypeChannels & { locks?: unknown };
  delete out.locks;
  for (const ch of GCS_NOTIFY_CHANNELS) {
    const lock = defaults.locks[ch];
    if (lock === "forced") out[ch] = "on";
    else if (lock === "disabled") out[ch] = "off";
  }
  return out;
}

/** Trece starea unui canal pentru o notificare (importantă sau nu). */
export const passes = (state: GcsChannelState, important: boolean): boolean => state === "on" || (state === "important" && important);

/**
 * Pe ce canale pleacă o notificare: stările efective, importanța ei și „Oprește toate emailurile” (din ACP, pentru un
 * membru), care oprește emailul chiar și pe un canal forțat.
 */
export function resolveDelivery(defaults: GcsTypeDefaults, override: GcsChannelOverride | null | undefined, opts: { important: boolean; emailsOff?: boolean }): GcsDelivery {
  const eff = effectiveChannels(defaults, override);
  return {
    site: passes(eff.site, opts.important),
    toast: passes(eff.toast, opts.important),
    push: passes(eff.push, opts.important),
    email: !opts.emailsOff && passes(eff.email, opts.important) ? eff.emailMode : null,
  };
}

/** O livrare fără niciun canal (nimic de creat). */
export const deliversNothing = (d: GcsDelivery): boolean => !d.site && !d.toast && !d.push && d.email === null;

/**
 * Alegerile unui membru, curățate înainte de salvare: fără canalele blocate și fără valorile egale cu cele implicite
 * (ca o schimbare ulterioară din ACP să ajungă și la el). `{}` = membrul urmează valorile implicite.
 */
export function cleanOverride(defaults: GcsTypeDefaults, raw: unknown): GcsChannelOverride {
  const wanted = parseOverride(raw);
  const out: GcsChannelOverride = {};
  for (const ch of GCS_NOTIFY_CHANNELS) {
    const v = wanted[ch];
    if (v === undefined || defaults.locks[ch] || v === defaults[ch]) continue;
    out[ch] = v;
  }
  // Modul emailului se poate alege doar cu emailul nedezactivat.
  if (wanted.emailMode && wanted.emailMode !== defaults.emailMode && defaults.locks.email !== "disabled") out.emailMode = wanted.emailMode;
  return out;
}

/** Valorile implicite trimise din ACP, validate: canalele lipsă rămân cele din cod. */
export function cleanDefaults(code: GcsTypeChannels, raw: { channels?: unknown; locks?: unknown }): { channels: GcsTypeChannels; locks: GcsChannelLocks } {
  return { channels: { ...code, ...parseOverride(raw.channels) }, locks: parseLocks(raw.locks) };
}
