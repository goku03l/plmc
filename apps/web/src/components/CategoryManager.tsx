import { useState } from "react";
import type { Category } from "../types";
import { useCategoryMutations } from "../hooks";

export default function CategoryManager({ projectId, categories }: { projectId: string; categories: Category[] }) {
  const m = useCategoryMutations(projectId);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#64748b");

  return (
    <div className="card cat-manager">
      <h3>Configurable sub-groups</h3>
      <p className="muted small">
        Sub-groups classify structure nodes (Interiors, Exteriors, MEP…). Fully editable per project — they drive the
        cost breakdown.
      </p>
      <div className="cat-list">
        {categories.map((c) => (
          <div key={c.id} className="cat-item">
            <input
              type="color"
              value={c.color}
              onChange={(e) => m.update.mutate({ id: c.id, color: e.target.value })}
            />
            <input
              defaultValue={c.label}
              key={c.id + c.label}
              onBlur={(e) => e.target.value !== c.label && m.update.mutate({ id: c.id, label: e.target.value })}
            />
            <span className="muted xs">{c.key}</span>
            <span className="muted xs">{c._count?.nodes ?? 0} nodes</span>
            <button
              className="icon-btn"
              title="Delete sub-group"
              onClick={() => confirm(`Delete sub-group “${c.label}”?`) && m.remove.mutate(c.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <form
        className="cat-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!key.trim() || !label.trim()) return;
          m.create.mutate(
            { key: key.trim(), label: label.trim(), color },
            {
              onSuccess: () => {
                setKey("");
                setLabel("");
                setColor("#64748b");
              },
            }
          );
        }}
      >
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        <input placeholder="key (e.g. landscaping)" value={key} onChange={(e) => setKey(e.target.value)} />
        <input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="btn primary sm">Add sub-group</button>
        {m.create.error && <span className="error small">{(m.create.error as Error).message}</span>}
      </form>
    </div>
  );
}
