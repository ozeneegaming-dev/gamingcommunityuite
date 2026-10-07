import type {
  GcsActor,
  GcsActorResolver,
  GcsAttachmentService,
  GcsEventBus,
  GcsGroupService,
  GcsModuleRegistry,
  GcsPermissionService,
  GcsRenderOptions,
} from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type { GcsImportEntity, GcsImportSchema } from "../types";

/** Pașii importului, în ordinea din specul modulului (§3.2); atașamentele vin înaintea postărilor. */
export const GCS_IMPORT_STEPS = [
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
  "finalize",
] as const;
export type GcsImportStepKey = (typeof GCS_IMPORT_STEPS)[number];

/** Ce se poate bifa în ACP. Grupurile și membrii se importă mereu (restul depinde de ei). */
export const GCS_IMPORT_OPTIONS = ["profile_fields", "forums", "attachments", "reactions", "conversations", "follows", "warnings", "statuses"] as const;
export type GcsImportOption = (typeof GCS_IMPORT_OPTIONS)[number];

export type GcsImportStepStatus = "pending" | "running" | "done" | "skipped" | "failed";

export type GcsImportStepState = {
  key: GcsImportStepKey;
  status: GcsImportStepStatus;
  total: number;
  done: number;
  imported: number;
  skipped: number;
  errors: number;
  /** Conținut cu elemente nerecunoscute (păstrate ca text). */
  unrecognized: number;
  cursor: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

/** Configurarea unui import (fără secrete: parola bazei vechi stă criptată separat). */
export type GcsImportConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  prefix: string;
  filesMode: "none" | "folder" | "url";
  filesPath: string;
  /** Adresa veche a site-ului (linkurile interne și cheia hărții de id-uri). */
  oldUrl: string;
  options: GcsImportOption[];
  /** Pornește redirecturile 301 la finalul importului. */
  redirects: boolean;
};

export type GcsImportDryRun = { linkedByEmail: number; sampledPosts: number; unrecognized: number; fallbacks: number };

export type GcsImportDetected = {
  schema: GcsImportSchema;
  prefix: string;
  version: string;
  supported: boolean;
  postsPerPage: number;
  counts: Record<GcsImportEntity, number>;
  dryRun?: GcsImportDryRun;
};

/** Serviciile de care are nevoie motorul (în `gcs-worker`, aceleași ca în web). */
export type GcsImportEngineDeps = {
  db: PrismaClient;
  bus: GcsEventBus;
  registry: GcsModuleRegistry;
  attachments: GcsAttachmentService;
  groups: GcsGroupService;
  permissions: GcsPermissionService;
  actors: GcsActorResolver;
  /** Opțiunile renderer-ului (embed-urile active, host-ul, etichetele în limba site-ului). */
  renderOptions: () => Promise<GcsRenderOptions>;
  /** Golește cache-ul Redis al paginilor după import. */
  clearCache: () => Promise<void>;
};

/** Oprirea cerută din ACP (pauză sau anulare), aruncată între loturi. */
export class GcsImportStop extends Error {
  constructor(readonly kind: "pause" | "cancel") {
    super(kind);
    this.name = "GcsImportStop";
  }
}

export type GcsImportActor = GcsActor;
