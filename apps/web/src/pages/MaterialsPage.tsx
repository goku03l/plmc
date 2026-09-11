import { useState } from "react";
import {
  useMaterialMutations,
  useMaterials,
  useMaterialSupplierMutations,
  useMaterialSuppliers,
  useSuppliers,
} from "../hooks";
const empty = { code: "", name: "", category: "", uom: "ea", unitCost: 0, wastagePct: 0 };

export default function MaterialsPage() {
  const [q, setQ] = useState("");
  const { data: materials, isLoading } = useMaterials(q);
  const m = useMaterialMutations();
  const [form, setForm] = useState(empty);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Material catalog</h1>
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <form
        className="card material-add"
        onSubmit={(e) => {
          e.preventDefault();
          m.create.mutate(form, { onSuccess: () => setForm(empty) });
        }}
      >
        <input required placeholder="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        <input required placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <input placeholder="UoM" value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })} className="w-uom" />
        <input type="number" step="any" min={0} placeholder="Unit cost" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: Number(e.target.value) })} className="w-qty" />
        <input type="number" step="any" min={0} max={100} placeholder="Waste %" value={form.wastagePct} onChange={(e) => setForm({ ...form, wastagePct: Number(e.target.value) })} className="w-qty" />
        <button className="btn primary sm">Add material</button>
        {m.create.error && <span className="error small">{(m.create.error as Error).message}</span>}
      </form>

      {isLoading && <p className="muted">Loading…</p>}
      <table className="data-table card">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Category</th>
            <th>UoM</th>
            <th className="r">Unit cost</th>
            <th className="r">Waste %</th>
            <th>Suppliers</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {materials?.map((mat) => (
            <MaterialRow
              key={mat.id}
              mat={mat}
              open={openId === mat.id}
              onToggle={() => setOpenId(openId === mat.id ? null : mat.id)}
              onRename={(name) => m.update.mutate({ id: mat.id, name })}
              onRate={(unitCost) => m.update.mutate({ id: mat.id, unitCost })}
              onDelete={() => confirm(`Delete ${mat.code}?`) && m.remove.mutate(mat.id)}
            />
          ))}
        </tbody>
      </table>
      <p className="muted small">{materials?.length ?? 0} materials · expand a row to assign supplier(s)</p>
    </div>
  );
}

function MaterialRow({
  mat,
  open,
  onToggle,
  onRename,
  onRate,
  onDelete,
}: {
  mat: { id: string; code: string; name: string; category?: string | null; uom: string; unitCost: number; wastagePct: number };
  open: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onRate: (n: number) => void;
  onDelete: () => void;
}) {
  const { data: links } = useMaterialSuppliers(open ? mat.id : null);

  return (
    <>
      <tr>
        <td className="mono">{mat.code}</td>
        <td>
          <input defaultValue={mat.name} key={mat.id + mat.name} onBlur={(e) => e.target.value !== mat.name && onRename(e.target.value)} />
        </td>
        <td>{mat.category ?? "—"}</td>
        <td>{mat.uom}</td>
        <td className="r">
          <input
            className="r cell-num"
            type="number"
            step="any"
            defaultValue={mat.unitCost}
            key={mat.id + mat.unitCost}
            onBlur={(e) => Number(e.target.value) !== mat.unitCost && onRate(Number(e.target.value))}
          />
        </td>
        <td className="r">{mat.wastagePct}</td>
        <td>
          <button className="btn sm" onClick={onToggle}>
            {open ? "▾" : "▸"} {links ? links.length : ""} supplier{links && links.length === 1 ? "" : "s"}
          </button>
        </td>
        <td>
          <button className="icon-btn" onClick={onDelete}>
            ✕
          </button>
        </td>
      </tr>
      {open && (
        <tr className="material-suppliers-row">
          <td colSpan={8}>
            <MaterialSuppliers materialId={mat.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function MaterialSuppliers({ materialId }: { materialId: string }) {
  const { data: links } = useMaterialSuppliers(materialId);
  const { data: allSuppliers } = useSuppliers();
  const mm = useMaterialSupplierMutations(materialId);
  const [sel, setSel] = useState("");

  const linked = new Set(links?.map((l) => l.supplierId));
  const available = (allSuppliers ?? []).filter((s) => !linked.has(s.id));

  return (
    <div className="material-suppliers">
      <div className="chips">
        {links?.map((l) => (
          <span key={l.id} className={`chip ${l.preferred ? "chip-pref" : ""}`}>
            {l.supplier.name}
            <button
              className="chip-x"
              title={l.preferred ? "Preferred" : "Mark preferred"}
              onClick={() => mm.link.mutate({ supplierId: l.supplierId, preferred: !l.preferred })}
            >
              {l.preferred ? "★" : "☆"}
            </button>
            <button className="chip-x" onClick={() => mm.unlink.mutate(l.supplierId)}>
              ✕
            </button>
          </span>
        ))}
        {links && links.length === 0 && <span className="muted small">No suppliers linked yet.</span>}
      </div>
      <div className="add-bom">
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">— add supplier —</option>
          {available.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.trades.length ? ` · ${s.trades.join(", ")}` : ""}
            </option>
          ))}
        </select>
        <button
          className="btn primary sm"
          disabled={!sel}
          onClick={() => sel && mm.link.mutate({ supplierId: sel }, { onSuccess: () => setSel("") })}
        >
          Link
        </button>
        <span className="muted xs">★ = preferred · linked suppliers appear in the BOM line picker</span>
      </div>
    </div>
  );
}
