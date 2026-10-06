-- Iconițele implicite ale grupurilor instalate (legenda, postbit-ul); doar unde nu au fost alese din ACP.
UPDATE "groups" SET "icon" = 'fa-solid fa-crown' WHERE "key" = 'root_admin' AND "icon" IS NULL;
UPDATE "groups" SET "icon" = 'fa-solid fa-shield-halved' WHERE "key" = 'admin' AND "icon" IS NULL;
UPDATE "groups" SET "icon" = 'fa-solid fa-user-shield' WHERE "key" = 'super_moderator' AND "icon" IS NULL;
UPDATE "groups" SET "icon" = 'fa-solid fa-shield' WHERE "key" = 'moderator' AND "icon" IS NULL;
UPDATE "groups" SET "icon" = 'fa-solid fa-user' WHERE "key" = 'member' AND "icon" IS NULL;
UPDATE "groups" SET "icon" = 'fa-solid fa-seedling' WHERE "key" = 'new_member' AND "icon" IS NULL;
UPDATE "groups" SET "icon" = 'fa-solid fa-ban' WHERE "key" = 'banned' AND "icon" IS NULL;
UPDATE "groups" SET "icon" = 'fa-solid fa-user-secret' WHERE "key" = 'guest' AND "icon" IS NULL;
UPDATE "groups" SET "icon" = 'fa-solid fa-medal' WHERE "key" = 'vip_bronze' AND "icon" IS NULL;
UPDATE "groups" SET "icon" = 'fa-solid fa-gem' WHERE "key" = 'vip_silver' AND "icon" IS NULL;
UPDATE "groups" SET "icon" = 'fa-solid fa-crown' WHERE "key" = 'vip_gold' AND "icon" IS NULL;
UPDATE "groups" SET "icon" = 'fa-solid fa-dragon' WHERE "key" = 'vip_legend' AND "icon" IS NULL;
