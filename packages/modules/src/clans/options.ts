import type { GcsSettingDef, GcsSettingsService } from "@gcs/core";
import { GCS_TAG_CHARSETS, type GcsTagCharset } from "./text";

/** Drepturile pe care liderul le poate da ofițerilor (specul 2026-10-08-clanuri §3.3). */
export const CLAN_OFFICER_RIGHTS = ["members", "invite", "requests", "edit", "forum", "events"] as const;
export type GcsClanRight = (typeof CLAN_OFFICER_RIGHTS)[number];

export const CLAN_REQUIRED_FIELDS = ["logo", "banner", "description"] as const;
export type GcsClanRequiredField = (typeof CLAN_REQUIRED_FIELDS)[number];
export const CLAN_TAG_PLACES = ["postbit", "hovercard", "profile"] as const;
export type GcsClanTagPlace = (typeof CLAN_TAG_PLACES)[number];
export const CLAN_FORUM_MODES = ["auto", "optional", "off"] as const;
export type GcsClanForumMode = (typeof CLAN_FORUM_MODES)[number];

/** Setările clanurilor (ACP → Gaming → Clanuri → Setări), toate în secțiunea `clans`. */
export const CLAN_SETTING = {
  requireApproval: "clans.require_approval",
  maxPerMember: "clans.max_per_member",
  leaveCooldownHours: "clans.leave_cooldown_hours",
  tagMin: "clans.tag_min",
  tagMax: "clans.tag_max",
  tagCharset: "clans.tag_charset",
  requiredFields: "clans.required_fields",
  logoMaxKb: "clans.logo_max_kb",
  bannerMaxKb: "clans.banner_max_kb",
  forumMode: "clans.forum_mode",
  forumParent: "clans.forum_parent",
  forumStaffGroups: "clans.forum_staff_groups",
  officerRights: "clans.officer_rights",
  inviteDays: "clans.invite_days",
  requestDays: "clans.request_days",
  archiveInactiveDays: "clans.archive_inactive_days",
  weightPosts: "clans.weight_posts",
  weightReputation: "clans.weight_reputation",
  weightActivity: "clans.weight_activity",
  weightMembers: "clans.weight_members",
  tagPlaces: "clans.tag_places",
  profileBadge: "clans.profile_badge",
} as const;

const int = (min: number, max: number) => (v: unknown) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : "invalid_range");
const subset = (allowed: readonly string[]) => (v: unknown) =>
  Array.isArray(v) && v.every((x) => typeof x === "string" && allowed.includes(x)) && new Set(v).size === v.length ? null : "invalid_choice";
const oneOf = (allowed: readonly string[]) => (v: unknown) => (typeof v === "string" && allowed.includes(v) ? null : "invalid_choice");

function setting(key: string, type: GcsSettingDef["type"], value: unknown, validate?: GcsSettingDef["validate"], options?: readonly string[]): GcsSettingDef {
  const def: GcsSettingDef = { key, type, default: value, section: "clans", labelKey: `settings.${key}` };
  if (validate) def.validate = validate;
  if (options) def.options = [...options];
  return def;
}

export const CLAN_SETTINGS: GcsSettingDef[] = [
  setting(CLAN_SETTING.requireApproval, "boolean", true),
  setting(CLAN_SETTING.maxPerMember, "number", 1, int(1, 10)),
  setting(CLAN_SETTING.leaveCooldownHours, "number", 24, int(0, 720)),
  setting(CLAN_SETTING.tagMin, "number", 2, int(1, 8)),
  setting(CLAN_SETTING.tagMax, "number", 5, int(1, 8)),
  setting(CLAN_SETTING.tagCharset, "string", "alnum", oneOf(GCS_TAG_CHARSETS), GCS_TAG_CHARSETS),
  setting(CLAN_SETTING.requiredFields, "json", ["description"], subset(CLAN_REQUIRED_FIELDS)),
  setting(CLAN_SETTING.logoMaxKb, "number", 512, int(16, 4096)),
  setting(CLAN_SETTING.bannerMaxKb, "number", 2048, int(64, 8192)),
  setting(CLAN_SETTING.forumMode, "string", "optional", oneOf(CLAN_FORUM_MODES), CLAN_FORUM_MODES),
  setting(CLAN_SETTING.forumParent, "number", 0, int(0, 2_147_483_647)),
  setting(CLAN_SETTING.forumStaffGroups, "json", ["admin", "super_moderator"], (v) =>
    Array.isArray(v) && v.length <= 50 && v.every((k) => typeof k === "string" && /^[a-z0-9_]{1,40}$/.test(k)) ? null : "invalid_choice",
  ),
  setting(CLAN_SETTING.officerRights, "json", [...CLAN_OFFICER_RIGHTS], subset(CLAN_OFFICER_RIGHTS)),
  setting(CLAN_SETTING.inviteDays, "number", 7, int(1, 60)),
  setting(CLAN_SETTING.requestDays, "number", 14, int(1, 60)),
  setting(CLAN_SETTING.archiveInactiveDays, "number", 0, (v) => (v === 0 ? null : int(14, 730)(v))),
  setting(CLAN_SETTING.weightPosts, "number", 1, int(0, 100)),
  setting(CLAN_SETTING.weightReputation, "number", 1, int(0, 100)),
  setting(CLAN_SETTING.weightActivity, "number", 10, int(0, 100)),
  setting(CLAN_SETTING.weightMembers, "number", 5, int(0, 100)),
  setting(CLAN_SETTING.tagPlaces, "json", [...CLAN_TAG_PLACES], subset(CLAN_TAG_PLACES)),
  setting(CLAN_SETTING.profileBadge, "boolean", true),
];

/** Opțiunile citite, cu tipurile lor. */
export type GcsClanOptions = {
  requireApproval: boolean;
  maxPerMember: number;
  leaveCooldownHours: number;
  tagMin: number;
  tagMax: number;
  tagCharset: GcsTagCharset;
  requiredFields: GcsClanRequiredField[];
  logoMaxKb: number;
  bannerMaxKb: number;
  forumMode: GcsClanForumMode;
  forumParent: number;
  forumStaffGroups: string[];
  officerRights: GcsClanRight[];
  inviteDays: number;
  requestDays: number;
  archiveInactiveDays: number;
  weights: { posts: number; reputation: number; activity: number; members: number };
  tagPlaces: GcsClanTagPlace[];
  profileBadge: boolean;
};

/** Toate opțiunile clanurilor, dintr-o singură citire a secțiunii (cache-uită de serviciul setărilor). */
export async function readClanOptions(settings: GcsSettingsService): Promise<GcsClanOptions> {
  const v = await settings.getMany("clans");
  const get = <T>(key: string) => v[key] as T;
  return {
    requireApproval: get<boolean>(CLAN_SETTING.requireApproval),
    maxPerMember: get<number>(CLAN_SETTING.maxPerMember),
    leaveCooldownHours: get<number>(CLAN_SETTING.leaveCooldownHours),
    tagMin: get<number>(CLAN_SETTING.tagMin),
    tagMax: Math.max(get<number>(CLAN_SETTING.tagMin), get<number>(CLAN_SETTING.tagMax)),
    tagCharset: get<GcsTagCharset>(CLAN_SETTING.tagCharset),
    requiredFields: get<GcsClanRequiredField[]>(CLAN_SETTING.requiredFields),
    logoMaxKb: get<number>(CLAN_SETTING.logoMaxKb),
    bannerMaxKb: get<number>(CLAN_SETTING.bannerMaxKb),
    forumMode: get<GcsClanForumMode>(CLAN_SETTING.forumMode),
    forumParent: get<number>(CLAN_SETTING.forumParent),
    forumStaffGroups: get<string[]>(CLAN_SETTING.forumStaffGroups),
    officerRights: get<GcsClanRight[]>(CLAN_SETTING.officerRights),
    inviteDays: get<number>(CLAN_SETTING.inviteDays),
    requestDays: get<number>(CLAN_SETTING.requestDays),
    archiveInactiveDays: get<number>(CLAN_SETTING.archiveInactiveDays),
    weights: {
      posts: get<number>(CLAN_SETTING.weightPosts),
      reputation: get<number>(CLAN_SETTING.weightReputation),
      activity: get<number>(CLAN_SETTING.weightActivity),
      members: get<number>(CLAN_SETTING.weightMembers),
    },
    tagPlaces: get<GcsClanTagPlace[]>(CLAN_SETTING.tagPlaces),
    profileBadge: get<boolean>(CLAN_SETTING.profileBadge),
  };
}
