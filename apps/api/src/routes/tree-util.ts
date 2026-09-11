import { prisma } from "../db.js";
import type { NodeCost, RawNode } from "../cost.js";

export type LoadedNode = RawNode & {
  name: string;
  type: string;
  refCode: string | null;
  uom: string;
  notes: string | null;
  attributes: unknown;
  categoryId: string | null;
  createdAt: Date;
  updatedAt: Date;
  bomLines: Array<
    RawNode["bomLines"][number] & {
      id: string;
      description: string;
      uom: string;
      materialId: string | null;
      constructionDetail: unknown;
      sortOrder: number;
    }
  >;
};

export async function loadProjectNodes(projectId: string): Promise<LoadedNode[]> {
  const nodes = await prisma.node.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      bomLines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });
  return nodes as unknown as LoadedNode[];
}

export type TreeNode = LoadedNode & { cost: NodeCost | null; children: TreeNode[] };

export function buildTree(nodes: LoadedNode[], costs: Map<string, NodeCost>): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const n of nodes) map.set(n.id, { ...n, cost: costs.get(n.id) ?? null, children: [] });

  const roots: TreeNode[] = [];
  for (const n of nodes) {
    const tn = map.get(n.id)!;
    if (n.parentId && map.has(n.parentId)) map.get(n.parentId)!.children.push(tn);
    else roots.push(tn);
  }

  const sortRec = (arr: TreeNode[]) => {
    arr.sort((a, b) => a.sortOrder - b.sortOrder);
    arr.forEach((c) => sortRec(c.children));
  };
  sortRec(roots);
  return roots;
}
