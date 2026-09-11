import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAssignSupplier, useSupplierAssignments, useSuppliers } from "../hooks";
import { num } from "../format";

export default function ProcurementPage() {
  const { projectId = "" } = useParams();
  const { data, isLoading, error } = useSupplierAssignments(projectId);
  const { data: suppliers } = useSuppliers();
  const assign = useAssignSupplier(projectId);
  const [view, setView] = useState<"material" | "supplier">("material");
  const [expanded, setExpanded] = useState<string | null>(null);

  if (isLoading) return <p className="muted page">Loading…</p>;
  if (error || !data) return <p className="error page">{(error as Error)?.message ?? "Not found"}</p>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to={`/projects/${projectId}`} className="muted small">
            ← {data.project.name}
          </Link>
          <h1>Supplier assignments</h1>
          <p className="muted small">Which supplier furnishes which material, and where in the structure.</p>
        </div>
        <div className="seg">
          <button className={view === "material" ? "on" : ""} onClick={() => setView("material")}>
            By material
          </button>
          <button className={view === "supplier" ? "on" : ""} onClick={() => setView("supplier")}>
            By supplier
          </button>
        </div>
      </div>

      {view === "material" && (
        <table className="data-table card">
          <thead>
            <tr>
              <th>Material</th>
              <th>Assigned supplier(s)</th>
              <th className="r">Qty</th>
              <th>Bulk assign</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.byMaterial.map((mrow) => {
              const open = expanded === mrow.materialId;
              return (
                <>
                  <tr key={mrow.materialId} className={mrow.unassignedLines > 0 ? "row-warn" : ""}>
                    <td>
                      <span className="mono">{mrow.code}</span> {mrow.name}
                    </td>
                    <td>
                      {mrow.assignments
                        .filter((a) => a.supplierId)
                        .map((a) => (
                          <span key={a.supplierId} className="chip">
                            {a.supplierName} <span className="muted xs">({a.lineCount})</span>
                          </span>
                        ))}
                      {mrow.unassignedLines > 0 && (
                        <span className="chip chip-warn">{mrow.unassignedLines} unassigned</span>
                      )}
                    </td>
                    <td className="r">
                      {num(mrow.assignments.reduce((s, a) => s + a.extendedQty, 0))} {mrow.uom}
                    </td>
                    <td>
                      <BulkAssign
                        suppliers={suppliers ?? []}
                        pending={assign.isPending}
                        onApply={(supplierId) => assign.mutate({ materialId: mrow.materialId, supplierId })}
                      />
                    </td>
                    <td>
                      <button
                        className="btn sm"
                        onClick={() => setExpanded(open ? null : mrow.materialId)}
                      >
                        {open ? "▾" : "▸"} where
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={5}>
                        <ul className="loc-list">
                          {mrow.assignments.flatMap((a) =>
                            a.locations.map((loc) => (
                              <li key={loc.nodeId + (a.supplierId ?? "none")}>
                                <span className={`chip ${a.supplierId ? "" : "chip-warn"}`}>
                                  {a.supplierName ?? "unassigned"}
                                </span>{" "}
                                {loc.nodePath}{" "}
                                <span className="muted xs">
                                  · {num(loc.extendedQty)} {mrow.uom}
                                </span>
                              </li>
                            )),
                          )}
                        </ul>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {data.byMaterial.length === 0 && (
              <tr>
                <td colSpan={5} className="muted center">
                  No catalog materials used in this project's BOM yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {view === "supplier" && (
        <div className="supplier-grid">
          {data.bySupplier.map((s) => (
            <div key={s.supplierId} className="card">
              <div className="supplier-name">{s.supplierName}</div>
              <table className="data-table" style={{ marginTop: 8 }}>
                <tbody>
                  {s.materials
                    .sort((a, b) => b.extendedQty - a.extendedQty)
                    .map((mm) => (
                      <tr key={mm.code}>
                        <td>
                          <span className="mono">{mm.code}</span> {mm.name}
                        </td>
                        <td className="r">
                          {num(mm.extendedQty)} {mm.uom}
                        </td>
                        <td className="r muted xs">{mm.lineCount} lines</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
          {data.bySupplier.length === 0 && <p className="muted">No suppliers assigned to any BOM line yet.</p>}
        </div>
      )}
    </div>
  );
}

function BulkAssign({
  suppliers,
  onApply,
  pending,
}: {
  suppliers: { id: string; name: string }[];
  onApply: (supplierId: string | null) => void;
  pending: boolean;
}) {
  const [sel, setSel] = useState("");
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <select value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">— choose —</option>
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
        <option value="__clear__">(clear all)</option>
      </select>
      <button
        className="btn sm"
        disabled={!sel || pending}
        onClick={() => {
          onApply(sel === "__clear__" ? null : sel);
          setSel("");
        }}
      >
        apply to all
      </button>
    </span>
  );
}
