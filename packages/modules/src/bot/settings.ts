/** Funcțiile nucleului care folosesc botul; pluginurile apar ca `plugin:<cheie>` (capabilitatea `bot.post`). */
export const BOT_CORE_FEATURES = ["welcome_pm", "moderation_notes", "scheduled"] as const;
export type GcsBotCoreFeature = (typeof BOT_CORE_FEATURES)[number];
/** Comutatoarele pe funcție (ACP › Sistem › Botul comunității): `{ [funcție]: boolean }`; lipsa = pornit. */
export const BOT_FEATURES_SETTING = "bot.features";
/** Titlul și textul mesajului de bun venit; `{name}` = numele membrului, `{site}` = numele site-ului. */
export const BOT_WELCOME_TITLE_SETTING = "bot.welcome_title";
export const BOT_WELCOME_SETTING = "bot.welcome_text";

export const pluginBotFeature = (pluginKey: string) => `plugin:${pluginKey}`;

/** Pagina din ACP (Sistem › Funcții › Botul comunității). */
export const BOT_ACP_SECTION = "system.bot";
/** Mesajul de bun venit, trimis din coadă după înregistrare (nu în cererea de înregistrare). */
export const BOT_WELCOME_JOB = "bot.welcome";
/** Postările programate scadente (la fiecare minut). */
export const BOT_SCHEDULED_JOB = "bot.scheduled";
