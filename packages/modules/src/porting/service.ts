/**
 * STUB TEMPORAR (doar pentru verificarea tipurilor interfeței web): aceeași semnătură publică cu serviciul real al
 * asistentului de portare. Se înlocuiește la îmbinare cu implementarea motorului; aici metodele nu fac nimic.
 */
import type { GcsAcpRoleService, GcsActor, GcsPluginService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type { GcsPortAnalysis, GcsPortFormat, GcsPortReport, GcsPortRightsBasis } from "./types";

type GcsPortLocale = "ro" | "en";

/** Secțiunea ACP a asistentului (ACP → Sistem → Conversii → Portare plugin); implicit doar Root Admin. */
export const PORTING_ACP_SECTION = "system.porting";
/** O portare (cu arhivele ei) se păstrează o zi. */
export const PORT_TTL_MS = 24 * 60 * 60 * 1000;

export type GcsPortStatus = "analyzed" | "converted";

/** O portare, cum o vede interfața (fără arhive). */
export type GcsPortView = {
  id: string;
  status: GcsPortStatus;
  fileName: string;
  format: GcsPortFormat;
  sourceName: string;
  sha256: string;
  createdAt: Date;
  analysis: GcsPortAnalysis;
  rights: { basis: GcsPortRightsBasis; confirmedAt: Date } | null;
  pluginKey: string | null;
  report: GcsPortReport | null;
  resultSize: number | null;
  canHandoff: boolean;
  expiresAt: Date;
};

/** Un rând din lista portărilor recente. */
export type GcsPortListItem = Pick<GcsPortView, "id" | "status" | "fileName" | "format" | "sourceName" | "pluginKey" | "createdAt"> & { automatedPercent: number | null };

/** Confirmarea de dinaintea conversiei. */
export type GcsPortConvertInput = {
  basis: GcsPortRightsBasis;
  confirmed: boolean;
  key?: string;
  locale?: GcsPortLocale;
};

export type GcsPortingServiceDeps = {
  db: PrismaClient;
  acp: GcsAcpRoleService;
  plugins: Pick<GcsPluginService, "stage">;
};

const stub = (): never => {
  throw new Error("porting_stub");
};

export class GcsPortingService {
  constructor(private readonly deps: GcsPortingServiceDeps) {}

  async analyze(_actor: GcsActor, _input: { fileName: string; data: Buffer }): Promise<GcsPortView> {
    void this.deps;
    return stub();
  }

  async get(_actor: GcsActor, _id: string): Promise<GcsPortView> {
    return stub();
  }

  async list(_actor: GcsActor, _limit = 10): Promise<GcsPortListItem[]> {
    return stub();
  }

  async convert(_actor: GcsActor, _id: string, _input: GcsPortConvertInput): Promise<GcsPortView> {
    return stub();
  }

  async download(_actor: GcsActor, _id: string): Promise<{ fileName: string; data: Buffer }> {
    return stub();
  }

  async handoff(_actor: GcsActor, _id: string): Promise<{ uploadId: string }> {
    return stub();
  }

  async delete(_actor: GcsActor, _id: string): Promise<void> {
    return stub();
  }
}
