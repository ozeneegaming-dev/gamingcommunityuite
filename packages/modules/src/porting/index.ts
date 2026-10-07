// Asistentul de portare a pluginurilor (ACP → Sistem → Conversii → Portare plugin, CLI `gcs:port`).
export {
  GcsPortingService,
  PORT_TTL_MS,
  PORTING_ACP_SECTION,
  type GcsPortConvertInput,
  type GcsPortingServiceDeps,
  type GcsPortListItem,
  type GcsPortStatus,
  type GcsPortView,
} from "./service";
export { PORT_SOURCE_LIMITS, readPortArchive } from "./archive";
export { analyzePortSource, readPortSource, suggestPluginKey } from "./detect";
export { convertPortSource, type GcsPortOptions, type GcsPortOutput } from "./generate";
export { noteText, portingMarkdown, type GcsPortLocale } from "./report";
export {
  GCS_PORT_AREAS,
  GCS_PORT_FORMATS,
  GCS_PORT_RIGHTS,
  type GcsPortAnalysis,
  type GcsPortArea,
  type GcsPortCodeKind,
  type GcsPortFormat,
  type GcsPortLicense,
  type GcsPortManualItem,
  type GcsPortMeta,
  type GcsPortNote,
  type GcsPortReport,
  type GcsPortRightsBasis,
} from "./types";
