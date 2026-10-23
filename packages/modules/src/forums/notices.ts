/** Tonurile mesajului unui moderator într-un topic (culorile temei: informare, atenționare, confirmare, pericol). */
export const NOTICE_TONES = ["info", "warn", "ok", "danger"] as const;
export type GcsNoticeTone = (typeof NOTICE_TONES)[number];

export const isNoticeTone = (v: unknown): v is GcsNoticeTone => typeof v === "string" && (NOTICE_TONES as readonly string[]).includes(v);
