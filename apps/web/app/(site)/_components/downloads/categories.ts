import type { GcsCategoryNode } from "@gcs/modules";

/** Categoriile ca listă plată, cu adâncimea (alegerea categoriei). */
export function flatCategories(list: GcsCategoryNode[]): { id: number; name: string; depth: number; vip: boolean }[] {
  const out: { id: number; name: string; depth: number; vip: boolean }[] = [];
  const walk = (nodes: GcsCategoryNode[]) => nodes.forEach((n) => (out.push({ id: n.id, name: n.name, depth: n.depth, vip: n.vip }), walk(n.children)));
  walk(list);
  return out;
}
