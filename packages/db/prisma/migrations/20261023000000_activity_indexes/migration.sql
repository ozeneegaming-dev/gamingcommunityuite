-- Indexurile paginilor din meniul principal (specul 2026-10-07-meniu-si-pagini): fluxul de activitate (topicurile,
-- răspunsurile și statusurile noi, cele mai noi primele) și clasamentul pe perioade (postări, reacții, XP recente).

-- CreateIndex
CREATE INDEX "topics_createdAt_id_idx" ON "topics"("createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "posts_createdAt_id_idx" ON "posts"("createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "content_reactions_createdAt_idx" ON "content_reactions"("createdAt");

-- CreateIndex
CREATE INDEX "status_updates_createdAt_id_idx" ON "status_updates"("createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "achievement_log_createdAt_idx" ON "achievement_log"("createdAt");
