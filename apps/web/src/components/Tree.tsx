import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Category, NodeType, TreeNode } from "../types";
import { useNodeMutations } from "../hooks";
import { money } from "../format";

const TYPES: NodeType[] = ["GROUP", "SUBGROUP", "ASSEMBLY", "COMPONENT"];

/** every node id in the given subtree(s) */
function collectIds(nodes: TreeNode[], acc: Set<string> = new Set()): Set<string> {
  for (const n of nodes) {
    acc.add(n.id);
    collectIds(n.children, acc);
  }
  return acc;
}

/** ids that should be expanded on first load — top two levels */
function defaultExpanded(nodes: TreeNode[], depth = 0, acc: Set<string> = new Set()): Set<string> {
  for (const n of nodes) {
    if (depth < 2 && n.children.length) acc.add(n.id);
    defaultExpanded(n.children, depth + 1, acc);
  }
  return acc;
}

type Menu = { node: TreeNode; x: number; y: number };

export default function Tree(props: {
  projectId: string;
  nodes: TreeNode[];
  categories: Category[];
  currency: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const m = useNodeMutations(props.projectId);
  const [addingRoot, setAddingRoot] = useState(false);
  const [addingChildOf, setAddingChildOf] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(props.nodes));
  const [menu, setMenu] = useState<Menu | null>(null);

  // re-seed the open/closed state only when switching to a different project
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setExpanded(defaultExpanded(props.nodes));
    setMenu(null);
    setAddingChildOf(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.projectId]);

  const isOpen = (id: string) => expanded.has(id);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  const expandAll = () => setExpanded(collectIds(props.nodes));
  const collapseAll = () => setExpanded(new Set());
  const expandSubtree = (node: TreeNode) => setExpanded((prev) => collectIds([node], new Set(prev)));
  const collapseSubtree = (node: TreeNode) =>
    setExpanded((prev) => {
      const s = new Set(prev);
      for (const id of collectIds([node])) s.delete(id);
      return s;
    });
  const openForChild = (id: string) => {
    setExpanded((prev) => new Set(prev).add(id));
    setAddingChildOf(id);
  };

  const rowProps = {
    categories: props.categories,
    currency: props.currency,
    selectedId: props.selectedId,
    onSelect: props.onSelect,
    mutations: m,
    isOpen,
    toggle,
    addingChildOf,
    setAddingChildOf,
    openForChild,
    openMenu: (node: TreeNode, x: number, y: number) => {
      props.onSelect(node.id);
      setMenu({ node, x, y });
    },
  };

  return (
    <div className="tree">
      <div className="tree-toolbar">
        <button className="btn sm" onClick={expandAll}>
          Expand all
        </button>
        <button className="btn sm" onClick={collapseAll}>
          Collapse all
        </button>
        <span className="muted xs">right-click a node for actions</span>
      </div>

      {props.nodes.map((n) => (
        <TreeRow key={n.id} node={n} depth={0} {...rowProps} />
      ))}

      {addingRoot ? (
        <AddNodeForm
          categories={props.categories}
          onCancel={() => setAddingRoot(false)}
          onSubmit={(data) => m.create.mutate({ ...data, parentId: null }, { onSuccess: () => setAddingRoot(false) })}
        />
      ) : (
        <button className="btn ghost add-root" onClick={() => setAddingRoot(true)}>
          + Add top-level group
        </button>
      )}

      {menu && (
        <ContextMenu
          menu={menu}
          close={() => setMenu(null)}
          onSelect={props.onSelect}
          expandSubtree={expandSubtree}
          collapseSubtree={collapseSubtree}
          addChild={openForChild}
          remove={(id) => m.remove.mutate(id)}
        />
      )}
    </div>
  );
}

type RowProps = {
  node: TreeNode;
  depth: number;
  categories: Category[];
  currency: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  mutations: ReturnType<typeof useNodeMutations>;
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  addingChildOf: string | null;
  setAddingChildOf: (id: string | null) => void;
  openForChild: (id: string) => void;
  openMenu: (node: TreeNode, x: number, y: number) => void;
};

function TreeRow(props: RowProps) {
  const { node, depth, categories, currency, selectedId, onSelect, mutations, isOpen, toggle } = props;
  const open = isOpen(node.id);
  const adding = props.addingChildOf === node.id;
  const cat = categories.find((c) => c.id === node.categoryId);
  const hasChildren = node.children.length > 0;

  return (
    <div className="tree-branch">
      <div
        className={`tree-row ${selectedId === node.id ? "selected" : ""}`}
        style={{ paddingLeft: 8 + depth * 18 }}
        onClick={() => onSelect(node.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          props.openMenu(node, e.clientX, e.clientY);
        }}
      >
        <button
          className={`twisty ${hasChildren ? "" : "hidden"}`}
          onClick={(e) => {
            e.stopPropagation();
            toggle(node.id);
          }}
        >
          {open ? "▾" : "▸"}
        </button>
        {cat && <span className="cat-dot" style={{ background: cat.color }} title={cat.label} />}
        <span className="tree-name">{node.name}</span>
        <span className={`type-tag t-${node.type}`}>{node.type}</span>
        {node.quantity !== 1 && (
          <span className="qty-tag">
            ×{node.quantity} {node.uom}
          </span>
        )}
        <span className="tree-cost">{money(node.cost?.rolledCost ?? 0, currency)}</span>
        <span className="tree-actions">
          <button
            title="Add child"
            onClick={(e) => {
              e.stopPropagation();
              props.openForChild(node.id);
            }}
          >
            +
          </button>
          <button
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete “${node.name}” and everything under it?`)) mutations.remove.mutate(node.id);
            }}
          >
            ✕
          </button>
        </span>
      </div>

      {open && (
        <>
          {node.children.map((c) => (
            <TreeRow key={c.id} {...props} node={c} depth={depth + 1} />
          ))}
          {adding && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 18 }}>
              <AddNodeForm
                categories={categories}
                defaultCategoryId={node.categoryId ?? undefined}
                onCancel={() => props.setAddingChildOf(null)}
                onSubmit={(data) =>
                  mutations.create.mutate(
                    { ...data, parentId: node.id },
                    { onSuccess: () => props.setAddingChildOf(null) }
                  )
                }
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ContextMenu(props: {
  menu: Menu;
  close: () => void;
  onSelect: (id: string) => void;
  expandSubtree: (n: TreeNode) => void;
  collapseSubtree: (n: TreeNode) => void;
  addChild: (id: string) => void;
  remove: (id: string) => void;
}) {
  const { menu, close } = props;
  const ref = useRef<HTMLDivElement>(null);
  const n = menu.node;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [close]);

  const hasChildren = n.children.length > 0;
  const style: CSSProperties = {
    top: Math.min(menu.y, window.innerHeight - 230),
    left: Math.min(menu.x, window.innerWidth - 200),
  };
  const run = (fn: () => void) => () => {
    fn();
    close();
  };

  return (
    <div className="ctx-menu" ref={ref} style={style} onClick={(e) => e.stopPropagation()}>
      <div className="ctx-title" title={n.name}>
        {n.name}
      </div>
      <button className="ctx-item" onClick={run(() => props.onSelect(n.id))}>
        Open in detail panel
      </button>
      {hasChildren && (
        <>
          <button className="ctx-item" onClick={run(() => props.expandSubtree(n))}>
            Expand this branch
          </button>
          <button className="ctx-item" onClick={run(() => props.collapseSubtree(n))}>
            Collapse this branch
          </button>
        </>
      )}
      <div className="ctx-sep" />
      <button className="ctx-item" onClick={run(() => props.addChild(n.id))}>
        Add child node
      </button>
      <button
        className="ctx-item danger"
        onClick={run(() => {
          if (confirm(`Delete “${n.name}” and everything under it?`)) props.remove(n.id);
        })}
      >
        Delete node
      </button>
    </div>
  );
}

export function AddNodeForm({
  categories,
  defaultCategoryId,
  onSubmit,
  onCancel,
}: {
  categories: Category[];
  defaultCategoryId?: string;
  onSubmit: (data: { name: string; type: NodeType; categoryId: string | null; quantity: number; uom: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<NodeType>("SUBGROUP");
  const [categoryId, setCategoryId] = useState<string>(defaultCategoryId ?? "");
  const [quantity, setQuantity] = useState(1);
  const [uom, setUom] = useState("ea");

  return (
    <form
      className="add-node"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSubmit({ name: name.trim(), type, categoryId: categoryId || null, quantity, uom });
      }}
    >
      <input autoFocus placeholder="Node name" value={name} onChange={(e) => setName(e.target.value)} />
      <select value={type} onChange={(e) => setType(e.target.value as NodeType)}>
        {TYPES.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
        <option value="">— category —</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={0}
        step="any"
        className="w-qty"
        value={quantity}
        onChange={(e) => setQuantity(Number(e.target.value))}
      />
      <input className="w-uom" value={uom} onChange={(e) => setUom(e.target.value)} />
      <button className="btn primary sm">Add</button>
      <button type="button" className="btn sm" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
