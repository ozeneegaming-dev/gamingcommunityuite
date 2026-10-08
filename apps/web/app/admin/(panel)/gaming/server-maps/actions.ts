"use server";

import { GcsValidationError, settingsAcpSection, type GcsResult } from "@gcs/core";
import { BRIDGE_SETTINGS_SECTION, SERVER_MAPS_ACP_SECTION, mapModeSetting, mapTemplateSetting } from "@gcs/modules";
import { isMapImageMode, mapTemplateError, mapTemplateHttpAllowed } from "@gcs/modules/map-images";
import { field, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Scoate imaginea unei hărți (rămâne arta generică; șablonul de adresă o poate aduce din nou). */
export async function removeMapImage(id: number): Promise<GcsResult<null>> {
  return runAcpAction(SERVER_MAPS_ACP_SECTION, "delete", async (actor) => {
    await services().bridge.maps.removeImage(actor, id);
    return null;
  });
}

/**
 * Șablonul imaginilor hărților și modul lui pentru un joc (din ACP → Gaming → Hărți): aceleași setări ca în Bridge și
 * ELO, deci același drept (editarea setărilor punții). Ambele valori se validează înainte de a salva ceva; valorile
 * neschimbate nu se rescriu (fără intrări inutile în jurnal).
 */
export async function saveMapTemplate(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(settingsAcpSection(BRIDGE_SETTINGS_SECTION), "edit", async (actor) => {
    const game = field(fd, "game");
    const templateKey = mapTemplateSetting(game);
    const modeKey = mapModeSetting(game);
    if (!templateKey || !modeKey) throw new GcsValidationError({ game: "invalid" });
    const template = field(fd, "template").trim();
    const mode = field(fd, "mode");
    const errors: Record<string, string> = {};
    const templateError = mapTemplateError(template, { allowHttp: mapTemplateHttpAllowed() });
    if (templateError) errors[templateKey] = templateError;
    if (!isMapImageMode(mode)) errors[modeKey] = "invalid_choice";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const { settings } = services();
    if ((await settings.get<string>(templateKey)) !== template) await settings.set(templateKey, template, actor);
    if ((await settings.get<string>(modeKey)) !== mode) await settings.set(modeKey, mode, actor);
    return null;
  });
}
