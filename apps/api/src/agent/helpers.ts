import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../db.js";

// Shared by both the read-only tools and the mutating ones.

export type AgentTool = {
  def: Anthropic.Tool;
  mutating: boolean;
  /** Only meaningful when mutating. true = irreversible (a delete) and goes
   *  through the propose-then-confirm dance. false/omitted = a normal create,
   *  update, move, or assignment — it just happens, like Claude Code editing a
   *  file: no permission round-trip for every routine change, only for the
   *  handful of actions that can't be undone. */
  destructive?: boolean;
  run: (input: Record<string, unknown>) => Promise<unknown>;
};

export const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export async function projectByRef(ref?: string) {
  if (!ref) return null;
  return (
    (await prisma.project.findFirst({
      where: { OR: [{ id: ref }, { code: { equals: ref, mode: "insensitive" } }, { name: { contains: ref, mode: "insensitive" } }] },
      include: { categories: { orderBy: { sortOrder: "asc" } } },
    })) ?? null
  );
}

export type FlatNode = { id: string; name: string; parentId: string | null; type: string; quantity: number };

export function nodePath(nodes: FlatNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (id: string) => {
    const parts: string[] = [];
    let cur = byId.get(id);
    let g = 0;
    while (cur && g++ < 100) {
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(" › ");
  };
}

/** All descendant node ids of `rootId`, inclusive of the root itself. */
export function subtreeIds(nodes: FlatNode[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const n of nodes) if (n.parentId) (children.get(n.parentId) ?? children.set(n.parentId, []).get(n.parentId)!).push(n.id);
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of children.get(id) ?? []) {
      out.add(c);
      stack.push(c);
    }
  }
  return out;
}

export const inr = (n: number, currency: string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(n || 0);

/**
 * A stable fingerprint of a mutating tool call, ignoring the `confirm` flag.
 * The agentic loop uses this to check whether this exact action was already
 * shown to the user (as a `pending` preview) in an EARLIER request, before it
 * will honour `confirm: true` — see runAgent() in chat.ts.
 */
export function actionKey(toolName: string, input: Record<string, unknown>): string {
  const { confirm: _confirm, __confirmKey: _key, ...rest } = input;
  const sorted = JSON.stringify(rest, Object.keys(rest).sort());
  return createHash("sha256").update(`${toolName}:${sorted}`).digest("hex").slice(0, 20);
}
