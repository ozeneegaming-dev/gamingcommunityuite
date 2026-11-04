import { gameDef, serverAddress, type GcsServerFieldsShown } from "@gcs/modules";
import { getTranslations } from "next-intl/server";
import type { GcsForumTabComponentProps } from "@/lib/forum-slot-components";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { saveForumExtensionTab } from "../actions";

const WHERE = ["row", "parent", "card", "topic"] as const;
const SHOW = ["status", "players", "map", "address", "connect", "top"] as const satisfies readonly (keyof GcsServerFieldsShown)[];
const STYLES = ["full", "compact", "status"] as const;

/**
 * Tabul „Server” din ACP › Forumuri › Editează (macheta E): serverul legat, stilul în liste, unde apar statisticile și
 * ce se afișează, pe trei coloane. Câmpurile au aceleași nume ca în extensie (`SERVER_TAB_FIELDS`) și se salvează prin
 * acțiunea comună a taburilor contribuite (validarea și valorile implicite rămân ale nucleului).
 */
export async function GcsForumServerTab({ forumId, extension, tab, values }: GcsForumTabComponentProps) {
  const t = await getTranslations("acp.forumServer");
  const rows = await services().servers.list();
  const linked = rows.find((r) => r.enabled && r.forumId === forumId);
  const chosen = typeof values.server === "string" ? values.server : "";
  const style = typeof values.style === "string" && (STYLES as readonly string[]).includes(values.style) ? values.style : "full";
  const on = (k: string, d = true) => (typeof values[k] === "boolean" ? (values[k] as boolean) : d);
  return (
    <GcsActionForm action={saveForumExtensionTab.bind(null, forumId, extension, tab)} submitLabel={t("save")} submitKind="save">
      <div className="gcsx-srvTab" data-testid="gcs-forum-server-tab">
        <div className="gcsx-srvTab__col">
          <label className="gcs-field" htmlFor="gcs-ext-server">
            <span className="gcsx-srvTab__h">{t("server")}</span>
            <select id="gcs-ext-server" className="gcs-input" name="server" defaultValue={chosen} data-testid="gcs-ext-server">
              <option value="">{linked ? t("serverAuto", { name: linked.name }) : t("serverNone")}</option>
              {rows.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.status?.online ? "● " : "○ "}
                  {r.name}
                  {serverAddress(gameDef(r.game), r.host, r.port) ? ` · ${serverAddress(gameDef(r.game), r.host, r.port)}` : ""}
                  {r.enabled ? "" : ` (${t("disabled")})`}
                </option>
              ))}
            </select>
            <span className="gcs-muted gcs-acpHint">{t("serverHint")}</span>
          </label>
          <fieldset className="gcsx-srvTab__set">
            <legend className="gcsx-srvTab__h">{t("style")}</legend>
            <div className="gcsx-srvTab__seg" role="radiogroup" aria-label={t("style")}>
              {STYLES.map((s) => (
                <label key={s} className="gcsx-srvTab__segItem">
                  <input type="radio" name="style" value={s} defaultChecked={style === s} data-testid={`gcs-ext-style-${s}`} />
                  <span>{t(`styles.${s}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <fieldset className="gcsx-srvTab__col gcsx-srvTab__set">
          <legend className="gcsx-srvTab__h">{t("whereTitle")}</legend>
          {WHERE.map((k) => (
            <label key={k} className="gcs-check gcsx-srvTab__check">
              <input type="checkbox" name={k} defaultChecked={on(k, k !== "topic")} data-testid={`gcs-ext-${k}`} />
              <span>
                {t(`where.${k}`)}
                {t.has(`where.${k}Hint` as never) && <small className="gcs-muted">{t(`where.${k}Hint` as never)}</small>}
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="gcsx-srvTab__col gcsx-srvTab__set">
          <legend className="gcsx-srvTab__h">{t("showTitle")}</legend>
          {SHOW.map((k) => (
            <label key={k} className="gcs-check gcsx-srvTab__check">
              <input type="checkbox" name={k} defaultChecked={on(k)} data-testid={`gcs-ext-${k}`} />
              <span>
                {t(`show.${k}`)}
                {k === "top" && <small className="gcs-muted">{t("show.topHint")}</small>}
              </span>
            </label>
          ))}
        </fieldset>
      </div>
    </GcsActionForm>
  );
}
