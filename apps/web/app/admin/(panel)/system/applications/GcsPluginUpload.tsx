"use client";

import { faFileZipper, faUpload } from "@fortawesome/free-solid-svg-icons";
import type { GcsResult } from "@gcs/core";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useErrorMessage } from "@/lib/use-error-message";

type Props = {
  labels: { file: string; hint: string; submit: string; uploading: string; network: string };
};

/**
 * Încărcarea unei arhive de plugin (`.zip`): trimisă la `/api/acp/plugins/upload`, validată pe server, apoi ecranul de
 * confirmare cu raportul verificărilor. Nimic nu se instalează la acest pas.
 */
export function GcsPluginUpload({ labels }: Props) {
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/acp/plugins/upload", { method: "POST", body: fd });
      const body = (await res.json()) as GcsResult<{ id: string }>;
      if (!body.ok) {
        setError(errorMessage(body.error));
        setPending(false);
        return;
      }
      router.push(`/admin/system/applications/install/${body.data.id}`);
    } catch {
      setError(labels.network);
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="gcs-pluginUpload" data-testid="gcs-plugin-upload">
      <label className="gcs-pluginUpload__drop">
        <span className="gcs-pluginUpload__icon" aria-hidden="true">
          <GcsIconSvg icon={faFileZipper} />
        </span>
        <span className="gcs-pluginUpload__text">
          <strong>{name ?? labels.file}</strong>
          <small>{labels.hint}</small>
        </span>
        <input type="file" name="file" accept=".zip,application/zip" className="gcs-srOnly" onChange={(e) => setName(e.currentTarget.files?.[0]?.name ?? null)} />
      </label>
      <div className="gcs-pluginUpload__actions">
        <GcsButton variant="primary" type="submit" disabled={pending} icon={<GcsIconSvg icon={faUpload} />}>
          {pending ? labels.uploading : labels.submit}
        </GcsButton>
        {error && (
          <span role="alert" className="gcs-pluginUpload__error">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
