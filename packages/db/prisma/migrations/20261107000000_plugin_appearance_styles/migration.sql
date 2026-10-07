-- Studio VIP 1.0.1: stilurile CSS scrise de un admin în ACP-ul unui plugin cu `appearance` (nume și bannere).
-- CreateTable
CREATE TABLE "plugin_appearance_styles" (
    "pluginKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "css" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugin_appearance_styles_pkey" PRIMARY KEY ("pluginKey","kind","key")
);

-- AddForeignKey
ALTER TABLE "plugin_appearance_styles" ADD CONSTRAINT "plugin_appearance_styles_pluginKey_fkey" FOREIGN KEY ("pluginKey") REFERENCES "plugins"("key") ON DELETE CASCADE ON UPDATE CASCADE;
