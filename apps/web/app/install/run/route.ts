import { runInstall } from "@gcs/core";
import type { NextRequest } from "next/server";
import { INSTALL_COOKIE, installInput, installState, targetDatabaseUrl } from "@/lib/install";
import { migrationsDir } from "@/lib/migrations";
import { resetServices, services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Rularea instalării (spec §17.1), cu progresul trimis prin Server-Sent Events. O singură rulare odată:
 * un al doilea POST în timpul rulării primește 409 (Review Focus #3). La final, browserul primește
 * adresa care îl loghează ca Root Admin.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const state = installState();
  if (!(await state.verifyInstallSession(request.cookies.get(INSTALL_COOKIE)?.value))) {
    return Response.json({ error: "session" }, { status: 403 });
  }
  if (await state.isInstalled()) return Response.json({ error: "installed" }, { status: 409 });
  if (!(await state.acquireRunLock())) return Response.json({ error: "busy" }, { status: 409 });

  const progress = await state.progress();
  const [input, databaseUrl] = await Promise.all([installInput(progress.data), targetDatabaseUrl(progress.data)]);
  if (!input || !databaseUrl) {
    await state.releaseRunLock();
    return Response.json({ error: "incomplete" }, { status: 400 });
  }
  const external = progress.data.database?.mode === "external";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        await state.advance("run");
        const { registry, cache, bus } = services();
        await runInstall(input, (e) => send("progress", e), { databaseUrl, migrationsDir: migrationsDir(), registry, cache, bus, state });
        if (external) {
          // Baza externă devine baza aplicației: rămâne în `.env.runtime`, citit la pornire.
          await state.writeSecrets({ DATABASE_URL: databaseUrl });
          process.env.DATABASE_URL = databaseUrl;
        }
        await state.clearInstallSecrets();
        await resetServices();
        const token = await state.createFinishToken(input.admin.email);
        send("done", { finishUrl: `/api/auth/gcs-install/finish?token=${token}` });
      } catch (error) {
        console.error("[RED-LINE] Instalarea a eșuat", error);
        send("error", { message: error instanceof Error ? error.message : String(error) });
      } finally {
        await state.releaseRunLock();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
