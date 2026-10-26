/** Funcțiile nucleului care folosesc botul; pluginurile apar ca `plugin:<cheie>` (capabilitatea `bot.post`). */
export const BOT_CORE_FEATURES = ["welcome_pm", "moderation_notes", "scheduled"] as const;
export type GcsBotCoreFeature = (typeof BOT_CORE_FEATURES)[number];
/** Comutatoarele pe funcție (ACP › Sistem › Botul comunității): `{ [funcție]: boolean }`; lipsa = valoarea implicită. */
export const BOT_FEATURES_SETTING = "bot.features";
/** Titlul și textul mesajului de bun venit; `{name}` = numele membrului, `{site}` = numele site-ului. */
export const BOT_WELCOME_TITLE_SETTING = "bot.welcome_title";
export const BOT_WELCOME_SETTING = "bot.welcome_text";

export const pluginBotFeature = (pluginKey: string) => `plugin:${pluginKey}`;

/**
 * Funcțiile oprite până le pornește adminul: bun venitul trimite un mesaj fiecărui membru nou, deci nu pornește singur
 * pe un site existent la actualizare. Restul (notele de moderare la cerere, postările programate, pluginurile instalate
 * explicit) sunt pornite implicit.
 */
export const BOT_FEATURES_OFF_BY_DEFAULT: readonly string[] = ["welcome_pm"];

/** Starea unei funcții după comutatoarele salvate și valoarea implicită. */
export const botFeatureOn = (saved: Record<string, boolean>, feature: string): boolean => saved[feature] ?? !BOT_FEATURES_OFF_BY_DEFAULT.includes(feature);

/** Pagina din ACP (Sistem › Funcții › Botul comunității). */
export const BOT_ACP_SECTION = "system.bot";
/** Mesajul de bun venit, trimis din coadă după înregistrare (nu în cererea de înregistrare). */
export const BOT_WELCOME_JOB = "bot.welcome";
/** Postările programate scadente (la fiecare minut). */
export const BOT_SCHEDULED_JOB = "bot.scheduled";
