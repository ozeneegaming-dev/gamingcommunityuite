import type { GcsLegacyPassword } from "@gcs/core";

/**
 * Importul din altă platformă (specul importului). Sursele se numesc după schema bazei lor de date:
 * - `core-schema`: tabele `core_members`, `forums_topics`… (prefix opțional), conținut HTML;
 * - `prefixed-schema`: tabele `xf_user`, `xf_thread`…, conținut BBCode.
 */
export type GcsImportSchema = "core-schema" | "prefixed-schema";
export type GcsContentFormat = "html" | "bbcode";

/** Rolul unui grup din sursă, după care se potrivește cu grupurile GCS. */
export type GcsSourceRole = "admin" | "moderator" | "member" | "guest" | "banned" | "other";

export type GcsVisibility = "VISIBLE" | "PENDING" | "HIDDEN";

export type SrcGroup = { id: string; name: string; color: string | null; role: GcsSourceRole };

export type SrcMember = {
  id: string;
  name: string;
  email: string;
  emailConfirmed: boolean;
  joinedAt: Date;
  lastVisitAt: Date | null;
  registrationIp: string | null;
  primaryGroupId: string;
  secondaryGroupIds: string[];
  /** Căi relative la rădăcina fișierelor vechi (ex. `uploads/monthly_2020_01/a.jpg`), încercate în ordine. */
  avatarPaths: string[];
  coverPaths: string[];
  /** Conținutul semnăturii, în formatul sursei. */
  signature: string;
  /** Doar dacă sursa o arată public. */
  birthday: { day: number; month: number; year: number | null } | null;
  reputation: number;
  title: string | null;
  ban: { reason: string; expiresAt: Date | null } | null;
  password: GcsLegacyPassword | null;
};

export type SrcProfileField = {
  id: string;
  name: string;
  type: "TEXT" | "TEXTAREA" | "URL" | "NUMBER" | "SELECT";
  options: string[];
  required: boolean;
  visibility: "PUBLIC" | "MEMBERS" | "STAFF";
  position: number;
  maxLength: number;
};
export type SrcProfileValue = { memberId: string; fieldId: string; value: string };

export type SrcForum = {
  id: string;
  parentId: string | null;
  type: "CATEGORY" | "FORUM" | "LINK";
  name: string;
  description: string;
  position: number;
  linkUrl: string | null;
};

export const GCS_FORUM_ACTIONS = ["view", "read", "create", "reply", "upload", "download"] as const;
export type GcsForumAction = (typeof GCS_FORUM_ACTIONS)[number];
/** Ce poate face un grup al sursei pe un forum (matricea tradusă). */
export type SrcForumPermission = { forumId: string; groupId: string; actions: GcsForumAction[] };

export type SrcPrefix = { id: string; name: string; color: string | null };

export type SrcPoll = {
  question: string;
  multiple: boolean;
  closesAt: Date | null;
  options: { id: string; text: string }[];
  votes: { optionId: string; memberId: string }[];
};

export type SrcTopic = {
  id: string;
  forumId: string;
  title: string;
  authorId: string | null;
  createdAt: Date;
  views: number;
  pinned: boolean;
  locked: boolean;
  visibility: GcsVisibility;
  prefixId: string | null;
  tags: string[];
  poll: SrcPoll | null;
  /** Un „topic mutat” (doar un link spre noua locație): nu se importă. */
  isRedirect: boolean;
};

export type SrcPost = {
  id: string;
  topicId: string;
  authorId: string | null;
  authorName: string;
  content: string;
  createdAt: Date;
  ip: string | null;
  visibility: GcsVisibility;
  editedAt: Date | null;
  editedById: string | null;
  attachmentIds: string[];
};

export type SrcAttachment = {
  id: string;
  ownerId: string | null;
  filename: string;
  /** Calea relativă la rădăcina fișierelor vechi. */
  path: string;
  size: number;
};

export type SrcReactionType = { id: string; name: string };
export type SrcReaction = { id: string; typeId: string; postId: string; memberId: string; createdAt: Date };

export type SrcConversation = {
  id: string;
  title: string;
  starterId: string | null;
  createdAt: Date;
  participants: { memberId: string; lastReadAt: Date | null; left: boolean }[];
  messages: SrcMessage[];
};
export type SrcMessage = {
  id: string;
  authorId: string | null;
  content: string;
  createdAt: Date;
  ip: string | null;
  attachmentIds: string[];
};

export type SrcFollow = { memberId: string; type: "forum" | "topic" | "user"; targetId: string };
export type SrcIgnore = { memberId: string; ignoredId: string };
export type SrcWarning = { id: string; memberId: string; issuerId: string | null; points: number; reason: string; createdAt: Date; expiresAt: Date | null };
export type SrcStatus = {
  id: string;
  profileId: string;
  authorId: string | null;
  parentId: string | null;
  content: string;
  createdAt: Date;
  ip: string | null;
  visibility: GcsVisibility;
};

/** Un lot citit din sursă și cursorul următorului (`null` = s-a terminat). */
export type GcsBatch<T> = { rows: T[]; next: string | null };

/** Tipurile numărate la testul conexiunii și în raport. */
export const GCS_IMPORT_ENTITIES = [
  "groups",
  "members",
  "profile_fields",
  "forums",
  "prefixes",
  "topics",
  "attachments",
  "posts",
  "reactions",
  "conversations",
  "follows",
  "warnings",
  "statuses",
] as const;
export type GcsImportEntity = (typeof GCS_IMPORT_ENTITIES)[number];

/**
 * Un adaptor de sursă: citește, doar pentru citire, înregistrările normalizate, pe loturi după id.
 * Fiecare metodă cu cursor întoarce lotul următor; `null` ca intrare = de la început.
 */
export interface GcsSourceAdapter {
  readonly schema: GcsImportSchema;
  readonly format: GcsContentFormat;
  version(): Promise<string>;
  /** Postările pe pagină ale site-ului vechi (pentru redirecturile paginilor). */
  postsPerPage(): Promise<number>;
  counts(): Promise<Record<GcsImportEntity, number>>;
  groups(): Promise<SrcGroup[]>;
  members(cursor: string | null, limit: number): Promise<GcsBatch<SrcMember>>;
  profileFields(): Promise<SrcProfileField[]>;
  profileValues(cursor: string | null, limit: number): Promise<GcsBatch<SrcProfileValue>>;
  forums(): Promise<SrcForum[]>;
  forumPermissions(): Promise<SrcForumPermission[]>;
  prefixes(): Promise<SrcPrefix[]>;
  topics(cursor: string | null, limit: number): Promise<GcsBatch<SrcTopic>>;
  attachments(cursor: string | null, limit: number): Promise<GcsBatch<SrcAttachment>>;
  posts(cursor: string | null, limit: number): Promise<GcsBatch<SrcPost>>;
  reactionTypes(): Promise<SrcReactionType[]>;
  reactions(cursor: string | null, limit: number): Promise<GcsBatch<SrcReaction>>;
  conversations(cursor: string | null, limit: number): Promise<GcsBatch<SrcConversation>>;
  follows(cursor: string | null, limit: number): Promise<GcsBatch<SrcFollow>>;
  ignores(cursor: string | null, limit: number): Promise<GcsBatch<SrcIgnore>>;
  warnings(cursor: string | null, limit: number): Promise<GcsBatch<SrcWarning>>;
  statuses(cursor: string | null, limit: number): Promise<GcsBatch<SrcStatus>>;
}
