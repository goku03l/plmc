import { useMemo, useState } from "react";
import {
  useWarehouses,
  useWarehouseMutations,
  useStock,
  useStockMutations,
  useStockMovements,
  useReservations,
  useReservationMutations,
  useProjectAvailability,
  useMaterials,
  useProjects,
} from "../hooks";
import { money, num } from "../format";
import type { AvailabilityRow, StockItem, StockMovementType } from "../types";

type Tab = "coverage" | "stock" | "warehouses" | "movements";

const TABS: { key: Tab; label: string }[] = [
  { key: "coverage", label: "Project coverage" },
  { key: "stock", label: "Stock on hand" },
  { key: "warehouses", label: "Warehouses" },
  { key: "movements", label: "Movements" },
];

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>("coverage");
  const [warehouseId, setWarehouseId] = useState("");
  const { data: warehouses } = useWarehouses();

  return (
    <div className="page">
      <div className="page-head">
        <h1>Inventory</h1>
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">All warehouses</option>
          {warehouses?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </select>
      </div>

      <div className="seg">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "coverage" && <CoverageTab warehouseId={warehouseId} />}
      {tab === "stock" && <StockTab warehouseId={warehouseId} />}
      {tab === "warehouses" && <WarehousesTab />}
      {tab === "movements" && <MovementsTab warehouseId={warehouseId} />}
    </div>
  );
}

/* ------------------------------------------------------------------ coverage */
/* The reason inventory exists: BOM demand minus what a warehouse already holds
   equals what still has to be bought. */

function CoverageTab({ warehouseId }: { warehouseId: string }) {
  const { data: projects } = useProjects();
  const [projectId, setProjectId] = useState("");
  const active = projectId || projects?.[0]?.id || "";
  const { data, isLoading } = useProjectAvailability(active, warehouseId || undefined);
  const [onlyShort, setOnlyShort] = useState(false);

  const rows = useMemo(
    () => (onlyShort ? (data?.rows ?? []).filter((r) => r.shortfall > 0) : data?.rows ?? []),
    [data, onlyShort],
  );

  const currency = data?.project.currency ?? "INR";

  return (
    <>
      <div className="tree-toolbar">
        <select value={active} onChange={(e) => setProjectId(e.target.value)}>
          {projects?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
        <label className="chk">
          <input type="checkbox" checked={onlyShort} onChange={(e) => setOnlyShort(e.target.checked)} /> Only what's short
        </label>
      </div>

      {isLoading && <p className="muted">Loading…</p>}

      {data && (
        <>
          <div className="summary-totals">
            <Stat label="Materials required" value={String(data.totals.materials)} />
            <Stat label="Fully covered by stock" value={`${data.totals.covered}`} tone="ok" />
            <Stat label="Partly covered" value={`${data.totals.partial}`} tone="warn" />
            <Stat label="Nothing in stock" value={`${data.totals.none}`} tone="bad" />
            <Stat label="Still to buy" value={money(data.totals.shortfallValue, currency)} big />
          </div>

          {data.totals.requiredValue > 0 && (
            <div className="card coverage-bar">
              <div className="bar-track">
                <div
                  className="bar-fill ok"
                  style={{ width: `${(data.totals.coveredValue / data.totals.requiredValue) * 100}%` }}
                />
              </div>
              <p className="muted small">
                {money(data.totals.coveredValue, currency)} of {money(data.totals.requiredValue, currency)} covered by
                stock on hand
                {warehouseId ? " (in the selected warehouse)" : " across all warehouses"}.
              </p>
            </div>
          )}

          {data.totals.unlinkedLines > 0 && (
            <div className="banner-warn">
              {data.totals.unlinkedLines} material line{data.totals.unlinkedLines === 1 ? "" : "s"} have no catalog
              material, so they can't be checked against stock. They're excluded from the figures above — link them to a
              material to include them.
            </div>
          )}

          <table className="data-table card">
            <thead>
              <tr>
                <th>Material</th>
                <th className="r">Required</th>
                <th className="r">On hand</th>
                <th className="r">Available</th>
                <th className="r">Shortfall</th>
                <th className="r">To buy</th>
                <th>Where it is</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <CoverageRow key={r.materialId} row={r} currency={currency} />
              ))}
            </tbody>
          </table>
          <p className="muted small">
            Required includes wastage. Available excludes stock reserved for other projects.
          </p>
        </>
      )}
    </>
  );
}

function CoverageRow({ row, currency }: { row: AvailabilityRow; currency: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className={row.status === "none" ? "row-warn" : undefined}>
        <td>
          <span className={`pill status-${row.status}`} />
          <span className="mono xs">{row.materialCode}</span> {row.materialName}
        </td>
        <td className="r cell-num">
          {num(row.required)} <span className="muted xs">{row.uom}</span>
        </td>
        <td className="r cell-num">{num(row.onHand)}</td>
        <td className="r cell-num">
          {num(row.available)}
          {row.reservedElsewhere > 0 && (
            <span className="muted xs" title="reserved by another project"> −{num(row.reservedElsewhere)}</span>
          )}
        </td>
        <td className="r cell-num strong">{row.shortfall > 0 ? num(row.shortfall) : "—"}</td>
        <td className="r cell-num">{row.shortfall > 0 ? money(row.shortfallValue, currency) : "—"}</td>
        <td>
          {row.locations.length === 0 ? (
            <span className="muted xs">not stocked</span>
          ) : (
            <button className="btn xs" onClick={() => setOpen(!open)}>
              {row.locations.length} location{row.locations.length === 1 ? "" : "s"}
            </button>
          )}
        </td>
      </tr>
      {open &&
        row.locations.map((l) => (
          <tr key={l.warehouseId} className="cov-loc">
            <td colSpan={7} className="small muted">
              &nbsp;&nbsp;↳ {l.code} {l.name}
              {l.binLocation ? ` · bin ${l.binLocation}` : ""} — {num(l.onHand)} {row.uom} on hand, {num(l.available)}{" "}
              free
            </td>
          </tr>
        ))}
    </>
  );
}

/* --------------------------------------------------------------------- stock */

function StockTab({ warehouseId }: { warehouseId: string }) {
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const { data: stock, isLoading } = useStock({ warehouseId: warehouseId || undefined, q, lowOnly });
  const { data: warehouses } = useWarehouses();
  const { data: materials } = useMaterials("");
  const m = useStockMutations();

  const [form, setForm] = useState({ warehouseId: "", materialId: "", onHand: 0, minLevel: 0, binLocation: "" });
  const [moveFor, setMoveFor] = useState<StockItem | null>(null);

  const totalValue = (stock ?? []).reduce((s, r) => s + r.value, 0);

  return (
    <>
      <form
        className="card material-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.warehouseId || !form.materialId) return;
          m.upsert.mutate(
            { ...form, binLocation: form.binLocation || null },
            { onSuccess: () => setForm({ ...form, materialId: "", onHand: 0, binLocation: "" }) },
          );
        }}
      >
        <select required value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}>
          <option value="">Warehouse…</option>
          {warehouses?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code}
            </option>
          ))}
        </select>
        <select required value={form.materialId} onChange={(e) => setForm({ ...form, materialId: e.target.value })}>
          <option value="">Material…</option>
          {materials?.map((mat) => (
            <option key={mat.id} value={mat.id}>
              {mat.code} — {mat.name}
            </option>
          ))}
        </select>
        <input
          type="number"
          step="any"
          className="w-qty"
          placeholder="On hand"
          value={form.onHand}
          onChange={(e) => setForm({ ...form, onHand: Number(e.target.value) })}
        />
        <input
          type="number"
          step="any"
          min={0}
          className="w-qty"
          placeholder="Min level"
          value={form.minLevel}
          onChange={(e) => setForm({ ...form, minLevel: Number(e.target.value) })}
        />
        <input
          className="w-uom"
          placeholder="Bin"
          value={form.binLocation}
          onChange={(e) => setForm({ ...form, binLocation: e.target.value })}
        />
        <button className="btn primary sm">Set stock</button>
        {m.upsert.error && <span className="error small">{(m.upsert.error as Error).message}</span>}
      </form>

      <div className="tree-toolbar">
        <input className="w-search" placeholder="Search material…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="chk">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Below min level
        </label>
        <span className="muted small">Stock value {money(totalValue, "INR")}</span>
      </div>

      {isLoading && <p className="muted">Loading…</p>}
      <table className="data-table card">
        <thead>
          <tr>
            <th>Warehouse</th>
            <th>Material</th>
            <th className="r">On hand</th>
            <th className="r">Reserved</th>
            <th className="r">Available</th>
            <th className="r">Min</th>
            <th>Bin</th>
            <th className="r">Value</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {stock?.map((s) => (
            <tr key={s.id} className={s.low ? "row-warn" : undefined}>
              <td className="mono xs">{s.warehouse.code}</td>
              <td>
                <span className="mono xs">{s.material.code}</span> {s.material.name}
              </td>
              <td className="r cell-num">
                {num(s.onHand)} <span className="muted xs">{s.uom}</span>
              </td>
              <td className="r cell-num">{s.reserved > 0 ? num(s.reserved) : "—"}</td>
              <td className="r cell-num strong">{num(s.available)}</td>
              <td className="r cell-num muted">{s.minLevel > 0 ? num(s.minLevel) : "—"}</td>
              <td className="xs muted">{s.binLocation ?? "—"}</td>
              <td className="r cell-num">{money(s.value, "INR")}</td>
              <td className="r">
                <button className="btn xs" onClick={() => setMoveFor(s)}>
                  Move
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {stock?.length === 0 && <p className="muted small">No stock recorded yet.</p>}

      {moveFor && <MoveDialog item={moveFor} onClose={() => setMoveFor(null)} />}
    </>
  );
}

/** Receive, issue, correct or transfer one stock line. */
function MoveDialog({ item, onClose }: { item: StockItem; onClose: () => void }) {
  const m = useStockMutations();
  const { data: warehouses } = useWarehouses();
  const { data: projects } = useProjects();
  const [type, setType] = useState<StockMovementType | "TRANSFER">("RECEIPT");
  const [quantity, setQuantity] = useState(0);
  const [projectId, setProjectId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const pending = m.move.isPending || m.transfer.isPending;
  const error = (m.move.error ?? m.transfer.error) as Error | null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quantity) return;
    if (type === "TRANSFER") {
      if (!toWarehouseId) return;
      m.transfer.mutate(
        {
          fromWarehouseId: item.warehouseId,
          toWarehouseId,
          materialId: item.materialId,
          quantity,
          reference: reference || null,
          note: note || null,
        },
        { onSuccess: onClose },
      );
    } else {
      m.move.mutate(
        {
          warehouseId: item.warehouseId,
          materialId: item.materialId,
          type,
          quantity,
          projectId: projectId || null,
          reference: reference || null,
          note: note || null,
        },
        { onSuccess: onClose },
      );
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="card move-dialog" onSubmit={submit}>
        <div className="pane-head">
          <strong>
            {item.material.code} — {item.material.name}
          </strong>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="muted small">
          {num(item.onHand)} {item.uom} at {item.warehouse.name}
          {item.reserved > 0 ? ` · ${num(item.reserved)} reserved` : ""}
        </p>

        <div className="seg">
          {(["RECEIPT", "ISSUE", "ADJUSTMENT", "TRANSFER"] as const).map((t) => (
            <button key={t} type="button" className={type === t ? "on" : ""} onClick={() => setType(t)}>
              {t === "RECEIPT" ? "Receive" : t === "ISSUE" ? "Issue" : t === "ADJUSTMENT" ? "Correct" : "Transfer"}
            </button>
          ))}
        </div>

        <div className="form-grid">
          <label>
            Quantity {type === "ADJUSTMENT" && <span className="muted xs">(negative to reduce)</span>}
            <input
              type="number"
              step="any"
              required
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </label>

          {type === "TRANSFER" && (
            <label>
              To warehouse
              <select required value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}>
                <option value="">Choose…</option>
                {warehouses
                  ?.filter((w) => w.id !== item.warehouseId)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </option>
                  ))}
              </select>
            </label>
          )}

          {type === "ISSUE" && (
            <label>
              Issued to project
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">— none —</option>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            Reference
            <input placeholder="GRN / PO / gate pass" value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
          <label>
            Note
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>

        {error && <p className="error small">{error.message}</p>}
        <div className="form-actions">
          <button type="button" className="btn sm" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary sm" disabled={pending}>
            {pending ? "Saving…" : "Record"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------- warehouses */

function WarehousesTab() {
  const { data: warehouses, isLoading } = useWarehouses();
  const m = useWarehouseMutations();
  const [form, setForm] = useState({ code: "", name: "", location: "" });

  return (
    <>
      <form
        className="card material-add"
        onSubmit={(e) => {
          e.preventDefault();
          m.create.mutate(form, { onSuccess: () => setForm({ code: "", name: "", location: "" }) });
        }}
      >
        <input required placeholder="Code" className="w-uom" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        <input required placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        <button className="btn primary sm">Add warehouse</button>
        {m.create.error && <span className="error small">{(m.create.error as Error).message}</span>}
      </form>

      {isLoading && <p className="muted">Loading…</p>}
      <table className="data-table card">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Location</th>
            <th className="r">Lines</th>
            <th className="r">Movements</th>
            <th className="r">Stock value</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {warehouses?.map((w) => (
            <tr key={w.id} className={w.isActive ? undefined : "muted"}>
              <td className="mono xs">{w.code}</td>
              <td>{w.name}</td>
              <td className="muted">{w.location ?? "—"}</td>
              <td className="r cell-num">{w._count?.stockItems ?? 0}</td>
              <td className="r cell-num">{w._count?.movements ?? 0}</td>
              <td className="r cell-num">{money(w.stockValue ?? 0, "INR")}</td>
              <td className="r">
                <button
                  className="icon-btn"
                  title="Delete warehouse and its stock history"
                  onClick={() =>
                    confirm(
                      `Delete ${w.code}? This removes its ${w._count?.stockItems ?? 0} stock line(s) and ${w._count?.movements ?? 0} movement(s). This cannot be undone.`,
                    ) && m.remove.mutate(w.id)
                  }
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {warehouses?.length === 0 && <p className="muted small">No warehouses yet — add one above.</p>}
    </>
  );
}

/* ----------------------------------------------------------------- movements */

const MOVE_LABEL: Record<StockMovementType, string> = {
  RECEIPT: "Received",
  ISSUE: "Issued",
  ADJUSTMENT: "Corrected",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
};

function MovementsTab({ warehouseId }: { warehouseId: string }) {
  const { data: moves, isLoading } = useStockMovements({ warehouseId: warehouseId || undefined });
  const { data: reservations } = useReservations({ warehouseId: warehouseId || undefined });
  const r = useReservationMutations();

  return (
    <>
      {reservations && reservations.length > 0 && (
        <>
          <h3 className="pane-head">Reserved for a project</h3>
          <table className="data-table card">
            <thead>
              <tr>
                <th>Project</th>
                <th>Material</th>
                <th>Warehouse</th>
                <th className="r">Quantity</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reservations.map((res) => (
                <tr key={res.id}>
                  <td className="mono xs">{res.project.code}</td>
                  <td>{res.stockItem.material.name}</td>
                  <td className="mono xs">{res.warehouse.code}</td>
                  <td className="r cell-num">
                    {num(res.quantity)} <span className="muted xs">{res.stockItem.material.uom}</span>
                  </td>
                  <td className="muted xs">{res.note ?? "—"}</td>
                  <td className="r">
                    <button className="icon-btn" title="Release" onClick={() => r.remove.mutate(res.id)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3 className="pane-head">Stock ledger</h3>
      {isLoading && <p className="muted">Loading…</p>}
      <table className="data-table card">
        <thead>
          <tr>
            <th>When</th>
            <th>What</th>
            <th>Material</th>
            <th>Warehouse</th>
            <th className="r">Quantity</th>
            <th>Project</th>
            <th>Reference</th>
          </tr>
        </thead>
        <tbody>
          {moves?.map((mv) => (
            <tr key={mv.id}>
              <td className="muted xs">{new Date(mv.createdAt).toLocaleString()}</td>
              <td>
                <span className={`chip t-${mv.type.toLowerCase()}`}>{MOVE_LABEL[mv.type]}</span>
              </td>
              <td>
                <span className="mono xs">{mv.material.code}</span> {mv.material.name}
              </td>
              <td className="mono xs">{mv.warehouse.code}</td>
              <td className="r cell-num">
                {num(mv.quantity)} <span className="muted xs">{mv.uom}</span>
              </td>
              <td className="muted xs">{mv.project?.code ?? "—"}</td>
              <td className="muted xs">{mv.reference ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {moves?.length === 0 && <p className="muted small">Nothing has moved yet.</p>}
      <p className="muted small">
        The ledger is append-only — a mistake is corrected with a new entry, never by editing an old one.
      </p>
    </>
  );
}

function Stat({ label, value, tone, big }: { label: string; value: string; tone?: string; big?: boolean }) {
  return (
    <div className={`stat${big ? " stat-big" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value${tone ? ` tone-${tone}` : ""}`}>{value}</div>
    </div>
  );
}
