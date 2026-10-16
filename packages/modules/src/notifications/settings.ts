import { NOTIFICATIONS_PRUNE_DAYS_SETTING, NOTIFICATIONS_PRUNE_UNREAD_SETTING, type GcsSettingDef } from "@gcs/core";

/** Rezumatul săptămânal „Ce ai ratat” (Notificări v2): pornit pe site, ziua (0 = duminică … 6 = sâmbătă) și ora. */
export const WEEKLY_ENABLED_SETTING = "notifications.weekly_enabled";
export const WEEKLY_DAY_SETTING = "notifications.weekly_day";
export const WEEKLY_HOUR_SETTING = "notifications.weekly_hour";

const intIn = (min: number, max: number) => (v: unknown) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : "invalid_range");

/**
 * Setările notificărilor din ACP → Membri → Setări membri → Notificări (secțiunea `notifications`, cu formularul paginii,
 * nu cel generic): programul digesturilor, rezumatul săptămânal și curățenia.
 */
export const NOTIFICATION_SETTING_DEFS: GcsSettingDef[] = [
  { key: WEEKLY_ENABLED_SETTING, type: "boolean", default: true, section: "notifications", labelKey: `settings.${WEEKLY_ENABLED_SETTING}` },
  { key: WEEKLY_DAY_SETTING, type: "number", default: 1, section: "notifications", labelKey: `settings.${WEEKLY_DAY_SETTING}`, validate: intIn(0, 6) },
  { key: WEEKLY_HOUR_SETTING, type: "number", default: 10, section: "notifications", labelKey: `settings.${WEEKLY_HOUR_SETTING}`, validate: intIn(0, 23) },
  { key: NOTIFICATIONS_PRUNE_DAYS_SETTING, type: "number", default: 90, section: "notifications", labelKey: `settings.${NOTIFICATIONS_PRUNE_DAYS_SETTING}`, validate: intIn(1, 3650) },
  { key: NOTIFICATIONS_PRUNE_UNREAD_SETTING, type: "boolean", default: false, section: "notifications", labelKey: `settings.${NOTIFICATIONS_PRUNE_UNREAD_SETTING}` },
];
