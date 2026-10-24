-- Ediția Lite (etapa 2): listele scalare (`text[]` / `integer[]`) devin `jsonb`, ca schema să meargă și pe MySQL.
-- Datele existente se păstrează (`to_jsonb`); valoarea implicită devine lista goală.

ALTER TABLE "staff_profiles" ALTER COLUMN "duties" DROP DEFAULT;
ALTER TABLE "staff_profiles" ALTER COLUMN "duties" SET DATA TYPE JSONB USING to_jsonb(COALESCE("duties", '{}'));
ALTER TABLE "staff_profiles" ALTER COLUMN "duties" SET DEFAULT '[]';
ALTER TABLE "staff_profiles" ALTER COLUMN "duties" SET NOT NULL;

ALTER TABLE "moderators" ALTER COLUMN "powers" DROP DEFAULT;
ALTER TABLE "moderators" ALTER COLUMN "powers" SET DATA TYPE JSONB USING to_jsonb(COALESCE("powers", '{}'));
ALTER TABLE "moderators" ALTER COLUMN "powers" SET DEFAULT '[]';
ALTER TABLE "moderators" ALTER COLUMN "powers" SET NOT NULL;

ALTER TABLE "system_state" ALTER COLUMN "seedMarks" DROP DEFAULT;
ALTER TABLE "system_state" ALTER COLUMN "seedMarks" SET DATA TYPE JSONB USING to_jsonb(COALESCE("seedMarks", '{}'));
ALTER TABLE "system_state" ALTER COLUMN "seedMarks" SET DEFAULT '[]';
ALTER TABLE "system_state" ALTER COLUMN "seedMarks" SET NOT NULL;

ALTER TABLE "forum_pages" ALTER COLUMN "audienceGroupIds" DROP DEFAULT;
ALTER TABLE "forum_pages" ALTER COLUMN "audienceGroupIds" SET DATA TYPE JSONB USING to_jsonb(COALESCE("audienceGroupIds", '{}'));
ALTER TABLE "forum_pages" ALTER COLUMN "audienceGroupIds" SET DEFAULT '[]';
ALTER TABLE "forum_pages" ALTER COLUMN "audienceGroupIds" SET NOT NULL;

ALTER TABLE "mod_saved_actions" ALTER COLUMN "forumIds" DROP DEFAULT;
ALTER TABLE "mod_saved_actions" ALTER COLUMN "forumIds" SET DATA TYPE JSONB USING to_jsonb(COALESCE("forumIds", '{}'));
ALTER TABLE "mod_saved_actions" ALTER COLUMN "forumIds" SET DEFAULT '[]';
ALTER TABLE "mod_saved_actions" ALTER COLUMN "forumIds" SET NOT NULL;

ALTER TABLE "profile_fields" ALTER COLUMN "options" DROP DEFAULT;
ALTER TABLE "profile_fields" ALTER COLUMN "options" SET DATA TYPE JSONB USING to_jsonb(COALESCE("options", '{}'));
ALTER TABLE "profile_fields" ALTER COLUMN "options" SET DEFAULT '[]';
ALTER TABLE "profile_fields" ALTER COLUMN "options" SET NOT NULL;

ALTER TABLE "group_promotions" ALTER COLUMN "fromGroupIds" DROP DEFAULT;
ALTER TABLE "group_promotions" ALTER COLUMN "fromGroupIds" SET DATA TYPE JSONB USING to_jsonb(COALESCE("fromGroupIds", '{}'));
ALTER TABLE "group_promotions" ALTER COLUMN "fromGroupIds" SET DEFAULT '[]';
ALTER TABLE "group_promotions" ALTER COLUMN "fromGroupIds" SET NOT NULL;

ALTER TABLE "name_styles" ALTER COLUMN "groupIds" DROP DEFAULT;
ALTER TABLE "name_styles" ALTER COLUMN "groupIds" SET DATA TYPE JSONB USING to_jsonb(COALESCE("groupIds", '{}'));
ALTER TABLE "name_styles" ALTER COLUMN "groupIds" SET DEFAULT '[]';
ALTER TABLE "name_styles" ALTER COLUMN "groupIds" SET NOT NULL;

ALTER TABLE "name_styles" ALTER COLUMN "badgeIds" DROP DEFAULT;
ALTER TABLE "name_styles" ALTER COLUMN "badgeIds" SET DATA TYPE JSONB USING to_jsonb(COALESCE("badgeIds", '{}'));
ALTER TABLE "name_styles" ALTER COLUMN "badgeIds" SET DEFAULT '[]';
ALTER TABLE "name_styles" ALTER COLUMN "badgeIds" SET NOT NULL;

ALTER TABLE "avatar_frames" ALTER COLUMN "groupIds" DROP DEFAULT;
ALTER TABLE "avatar_frames" ALTER COLUMN "groupIds" SET DATA TYPE JSONB USING to_jsonb(COALESCE("groupIds", '{}'));
ALTER TABLE "avatar_frames" ALTER COLUMN "groupIds" SET DEFAULT '[]';
ALTER TABLE "avatar_frames" ALTER COLUMN "groupIds" SET NOT NULL;

ALTER TABLE "avatar_frames" ALTER COLUMN "badgeIds" DROP DEFAULT;
ALTER TABLE "avatar_frames" ALTER COLUMN "badgeIds" SET DATA TYPE JSONB USING to_jsonb(COALESCE("badgeIds", '{}'));
ALTER TABLE "avatar_frames" ALTER COLUMN "badgeIds" SET DEFAULT '[]';
ALTER TABLE "avatar_frames" ALTER COLUMN "badgeIds" SET NOT NULL;

ALTER TABLE "notifications" ALTER COLUMN "actorIds" DROP DEFAULT;
ALTER TABLE "notifications" ALTER COLUMN "actorIds" SET DATA TYPE JSONB USING to_jsonb(COALESCE("actorIds", '{}'));
ALTER TABLE "notifications" ALTER COLUMN "actorIds" SET DEFAULT '[]';
ALTER TABLE "notifications" ALTER COLUMN "actorIds" SET NOT NULL;

ALTER TABLE "chat_moderator_grants" ALTER COLUMN "rights" DROP DEFAULT;
ALTER TABLE "chat_moderator_grants" ALTER COLUMN "rights" SET DATA TYPE JSONB USING to_jsonb(COALESCE("rights", '{}'));
ALTER TABLE "chat_moderator_grants" ALTER COLUMN "rights" SET DEFAULT '[]';
ALTER TABLE "chat_moderator_grants" ALTER COLUMN "rights" SET NOT NULL;

ALTER TABLE "chat_moderator_grants" ALTER COLUMN "rooms" DROP DEFAULT;
ALTER TABLE "chat_moderator_grants" ALTER COLUMN "rooms" SET DATA TYPE JSONB USING to_jsonb(COALESCE("rooms", '{}'));
ALTER TABLE "chat_moderator_grants" ALTER COLUMN "rooms" SET DEFAULT '[]';
ALTER TABLE "chat_moderator_grants" ALTER COLUMN "rooms" SET NOT NULL;

ALTER TABLE "nav_items" ALTER COLUMN "groups" DROP DEFAULT;
ALTER TABLE "nav_items" ALTER COLUMN "groups" SET DATA TYPE JSONB USING to_jsonb(COALESCE("groups", '{}'));
ALTER TABLE "nav_items" ALTER COLUMN "groups" SET DEFAULT '[]';
ALTER TABLE "nav_items" ALTER COLUMN "groups" SET NOT NULL;

ALTER TABLE "widget_placements" ALTER COLUMN "groups" DROP DEFAULT;
ALTER TABLE "widget_placements" ALTER COLUMN "groups" SET DATA TYPE JSONB USING to_jsonb(COALESCE("groups", '{}'));
ALTER TABLE "widget_placements" ALTER COLUMN "groups" SET DEFAULT '[]';
ALTER TABLE "widget_placements" ALTER COLUMN "groups" SET NOT NULL;

ALTER TABLE "chat_pro_profiles" ALTER COLUMN "badgeIds" DROP DEFAULT;
ALTER TABLE "chat_pro_profiles" ALTER COLUMN "badgeIds" SET DATA TYPE JSONB USING to_jsonb(COALESCE("badgeIds", '{}'));
ALTER TABLE "chat_pro_profiles" ALTER COLUMN "badgeIds" SET DEFAULT '[]';
ALTER TABLE "chat_pro_profiles" ALTER COLUMN "badgeIds" SET NOT NULL;

ALTER TABLE "chat_pro_profiles" ALTER COLUMN "emoteFavorites" DROP DEFAULT;
ALTER TABLE "chat_pro_profiles" ALTER COLUMN "emoteFavorites" SET DATA TYPE JSONB USING to_jsonb(COALESCE("emoteFavorites", '{}'));
ALTER TABLE "chat_pro_profiles" ALTER COLUMN "emoteFavorites" SET DEFAULT '[]';
ALTER TABLE "chat_pro_profiles" ALTER COLUMN "emoteFavorites" SET NOT NULL;

ALTER TABLE "chat_pro_bar_items" ALTER COLUMN "groupIds" DROP DEFAULT;
ALTER TABLE "chat_pro_bar_items" ALTER COLUMN "groupIds" SET DATA TYPE JSONB USING to_jsonb(COALESCE("groupIds", '{}'));
ALTER TABLE "chat_pro_bar_items" ALTER COLUMN "groupIds" SET DEFAULT '[]';
ALTER TABLE "chat_pro_bar_items" ALTER COLUMN "groupIds" SET NOT NULL;

ALTER TABLE "plugins" ALTER COLUMN "capabilities" DROP DEFAULT;
ALTER TABLE "plugins" ALTER COLUMN "capabilities" SET DATA TYPE JSONB USING to_jsonb(COALESCE("capabilities", '{}'));
ALTER TABLE "plugins" ALTER COLUMN "capabilities" SET DEFAULT '[]';
ALTER TABLE "plugins" ALTER COLUMN "capabilities" SET NOT NULL;

ALTER TABLE "plugins" ALTER COLUMN "migrations" DROP DEFAULT;
ALTER TABLE "plugins" ALTER COLUMN "migrations" SET DATA TYPE JSONB USING to_jsonb(COALESCE("migrations", '{}'));
ALTER TABLE "plugins" ALTER COLUMN "migrations" SET DEFAULT '[]';
ALTER TABLE "plugins" ALTER COLUMN "migrations" SET NOT NULL;

ALTER TABLE "game_servers" ALTER COLUMN "groups" DROP DEFAULT;
ALTER TABLE "game_servers" ALTER COLUMN "groups" SET DATA TYPE JSONB USING to_jsonb(COALESCE("groups", '{}'));
ALTER TABLE "game_servers" ALTER COLUMN "groups" SET DEFAULT '[]';
ALTER TABLE "game_servers" ALTER COLUMN "groups" SET NOT NULL;

ALTER TABLE "clans" ALTER COLUMN "officerRights" DROP DEFAULT;
ALTER TABLE "clans" ALTER COLUMN "officerRights" SET DATA TYPE JSONB USING to_jsonb(COALESCE("officerRights", '{}'));
ALTER TABLE "clans" ALTER COLUMN "officerRights" SET DEFAULT '[]';
ALTER TABLE "clans" ALTER COLUMN "officerRights" SET NOT NULL;

ALTER TABLE "donation_goals" ALTER COLUMN "groupIds" DROP DEFAULT;
ALTER TABLE "donation_goals" ALTER COLUMN "groupIds" SET DATA TYPE JSONB USING to_jsonb(COALESCE("groupIds", '{}'));
ALTER TABLE "donation_goals" ALTER COLUMN "groupIds" SET DEFAULT '[]';
ALTER TABLE "donation_goals" ALTER COLUMN "groupIds" SET NOT NULL;
