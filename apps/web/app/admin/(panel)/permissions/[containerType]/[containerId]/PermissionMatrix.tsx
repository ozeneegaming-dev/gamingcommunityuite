"use client";

import { useState } from "react";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { saveContainerPermissions } from "../../actions";

type Props = {
  containerType: string;
  containerId: string;
  groups: { id: number; key: string; name: string }[];
  actions: { key: string; label: string }[];
  allowed: string[];
  inherit: { inherits: boolean; parentId: string };
  labels: { group: string; inherit: string; parentId: string; save: string; cell: Record<string, string> };
};

/** Matricea grupuri × acțiuni (spec §6.2). Bifa „Moștenește” dezactivează tabelul. */
export function PermissionMatrix({ containerType, containerId, groups, actions, allowed, inherit, labels }: Props) {
  const [inherits, setInherits] = useState(inherit.inherits);
  const allowedSet = new Set(allowed);
  return (
    <GcsActionForm action={saveContainerPermissions.bind(null, containerType, containerId)} submitLabel={labels.save} submitKind="save">
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, minHeight: 44 }}>
          <input
            type="checkbox"
            name="inherits"
            checked={inherits}
            onChange={(e) => setInherits(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: "var(--gcs-accent)" }}
          />
          {labels.inherit}
        </label>
        <label className="gcs-field">
          {labels.parentId}
          <input className="gcs-input" name="parentId" defaultValue={inherit.parentId} style={{ maxWidth: 200 }} />
        </label>
      </div>
      <fieldset disabled={inherits} style={{ border: 0, padding: 0, margin: 0, opacity: inherits ? 0.45 : 1 }}>
        <div className="gcs-table">
          <table className="gcs-table__table">
            <thead>
              <tr>
                <th className="gcs-table__th" scope="col">
                  {labels.group}
                </th>
                {actions.map((a) => (
                  <th key={a.key} className="gcs-table__th" scope="col" style={{ textAlign: "center" }}>
                    {a.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id} className="gcs-table__row">
                  <th className="gcs-table__td" scope="row" style={{ textAlign: "left" }}>
                    <span className={`gcs-name--${g.key}`}>{g.name}</span>
                  </th>
                  {actions.map((a) => (
                    <td key={a.key} className="gcs-table__td" style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        name={`allow:${g.id}:${a.key}`}
                        defaultChecked={allowedSet.has(`${g.id}:${a.key}`)}
                        aria-label={labels.cell[`${g.id}:${a.key}`]}
                        style={{ width: 20, height: 20, accentColor: "var(--gcs-accent)" }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
    </GcsActionForm>
  );
}
