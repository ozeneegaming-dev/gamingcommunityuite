import { GcsForbidden } from "@gcs/core";
import { notFound } from "next/navigation";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Rută folosită doar de testele E2E (`/_test/container/<tip>/<id>`), activă cu `GCS_TEST_ROUTES=1`:
 * verifică `core.test_view` pe container prin `permissions.assert`, ca orice pagină reală.
 */
export default async function TestContainerPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  if (process.env.GCS_TEST_ROUTES !== "1") notFound();
  const { type, id } = await params;
  try {
    await services().permissions.assert(await currentActor(), "core.test_view", { type, id });
  } catch (error) {
    if (error instanceof GcsForbidden) notFound();
    throw error;
  }
  return <main data-testid="gcs-test-container">OK {type}:{id}</main>;
}
