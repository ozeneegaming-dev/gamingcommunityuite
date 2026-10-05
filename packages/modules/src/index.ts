// @gcs/modules — câte un folder pe modul.
export { coreModule, DEFAULT_GROUP_KEYS } from "./core-module";
export { forumsModule } from "./forums";
export { GcsForumCounters } from "./forums/counters";
export { FORUMS_ACP_SECTION, GcsForumService, type GcsForumInput, type GcsForumOrderItem, type GcsForumPatch } from "./forums/forums";
export { GcsForumPosting, type GcsForumDeps } from "./forums/posting";
export { GcsPostService, type GcsEditInput, type GcsReplyInput, type GcsReplyResult, type GcsRevisionView } from "./forums/posts";
export * from "./forums/queries";
export { GcsReadMarkerService, UNREAD_DAYS } from "./forums/readMarkers";
export { DEFAULT_REACTIONS } from "./forums/seed";
export { parseRef, slugify } from "./forums/slug";
export { GcsTopicService, type GcsNewTopicInput, type GcsNewTopicResult } from "./forums/topics";
