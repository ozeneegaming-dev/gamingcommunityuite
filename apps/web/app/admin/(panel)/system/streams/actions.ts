"use server";

import { GcsNotFound, GcsValidationError, type GcsActor, type GcsResult } from "@gcs/core";
import { GCS_STREAM_KINDS, loadStreamsConfig, STREAMS_ACP_SECTION, STREAMS_SETTING, streamKey, streamsConfigError, type GcsStreamsConfig } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const kindsOf = (fd: FormData) => GCS_STREAM_KINDS.filter((k) => fd.get(`kind:${k}`) === "on");
const forumsOf = (fd: FormData, name: string) =>
  fd
    .getAll(name)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

async function store(value: GcsStreamsConfig, actor: GcsActor): Promise<void> {
  const error = streamsConfigError(value);
  if (error) throw new GcsValidationError({ kinds: error });
  await services().settings.set(STREAMS_SETTING, value, actor);
}

/** Fluxul „Tot”: tipurile, forumurile excluse din toată activitatea, elementele pe pagină. */
export async function saveStreamSettings(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(STREAMS_ACP_SECTION, "edit", async (actor) => {
    const cfg = await loadStreamsConfig(services().settings);
    await store({ ...cfg, kinds: kindsOf(fd), excludeForumIds: forumsOf(fd, "excludeForumId"), perPage: intField(fd, "perPage") }, actor);
    return null;
  });
}

/** Un flux propriu: nou (`key` = `null`) sau modificat. */
export async function saveStream(key: string | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(STREAMS_ACP_SECTION, "edit", async (actor) => {
    const cfg = await loadStreamsConfig(services().settings);
    const name = field(fd, "name").trim();
    const next = { key: key ?? streamKey(name, cfg.custom.map((s) => s.key)), name, icon: field(fd, "icon").trim(), kinds: kindsOf(fd), forumIds: forumsOf(fd, "forumId") };
    if (key !== null && !cfg.custom.some((s) => s.key === key)) throw new GcsNotFound({ entity: "stream" });
    const custom = key === null ? [...cfg.custom, next] : cfg.custom.map((s) => (s.key === key ? next : s));
    await store({ ...cfg, custom }, actor);
    return null;
  });
}

export async function deleteStream(key: string): Promise<GcsResult<null>> {
  return runAcpAction(STREAMS_ACP_SECTION, "delete", async (actor) => {
    const cfg = await loadStreamsConfig(services().settings);
    await store({ ...cfg, custom: cfg.custom.filter((s) => s.key !== key) }, actor);
    return null;
  });
}

/** Mută un flux propriu cu o poziție (ordinea tab-urilor). */
export async function moveStream(key: string, dir: -1 | 1): Promise<GcsResult<null>> {
  return runAcpAction(STREAMS_ACP_SECTION, "edit", async (actor) => {
    const cfg = await loadStreamsConfig(services().settings);
    const i = cfg.custom.findIndex((s) => s.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cfg.custom.length) return null;
    const custom = [...cfg.custom];
    [custom[i], custom[j]] = [custom[j]!, custom[i]!];
    await store({ ...cfg, custom }, actor);
    return null;
  });
}
