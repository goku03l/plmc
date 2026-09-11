import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useRfq, useRfqMutations, useSuppliers } from "../hooks";
import { money } from "../format";
import { STATUS_LABEL } from "./RfqsPage";
import type { Rfq } from "../types";

export default function RfqDetailPage() {
  const { rfqId = "" } = useParams();
  const { data: rfq, isLoading, error } = useRfq(rfqId);
  const m = useRfqMutations(rfqId);

  if (isLoading) return <p className="muted page">Loading RFQ…</p>;
  if (error || !rfq) return <p className="error page">{(error as Error)?.message ?? "Not found"}</p>;

  const cur = rfq.project.currency;

  return (
    <div className="page rfq-page">
      <div className="page-head">
        <div>
          <Link to="/rfqs" className="muted small">
            ← RFQs
          </Link>
          <h1>
            <span className="muted">{rfq.number}</span>{" "}
            <input
              className="rfq-title-input"
              defaultValue={rfq.title}
              key={rfq.title}
              onBlur={(e) => e.target.value !== rfq.title && m.update.mutate({ id: rfq.id, title: e.target.value })}
            />
          </h1>
          <p className="muted small">
            <Link to={`/projects/${rfq.projectId}`}>{rfq.project.name}</Link>
            {rfq.node && <> · node: {rfq.node.name}</>}
          </p>
        </div>
        <div className="rfq-head-right">
          <span className={`pill rfq-${rfq.status}`}>{STATUS_LABEL[rfq.status]}</span>
          <label className="muted xs">
            due{" "}
            <input
              type="date"
              defaultValue={rfq.dueDate ? rfq.dueDate.slice(0, 10) : ""}
              onBlur={(e) =>
                m.update.mutate({
                  id: rfq.id,
                  dueDate: e.target.value ? new Date(e.target.value).toISOString() : null,
                })
              }
            />
          </label>
        </div>
      </div>

      <label className="notes card">
        Scope / instructions to bidders
        <textarea
          defaultValue={rfq.scope ?? ""}
          key={rfq.scope ?? ""}
          onBlur={(e) => (e.target.value || null) !== rfq.scope && m.update.mutate({ id: rfq.id, scope: e.target.value || null })}
        />
      </label>

      <Items rfq={rfq} m={m} cur={cur} />
      <SuppliersSection rfq={rfq} m={m} />
      <Comparison rfq={rfq} m={m} cur={cur} />
    </div>
  );
}

type M = ReturnType<typeof useRfqMutations>;

function Items({ rfq, m, cur }: { rfq: Rfq; m: M; cur: string }) {
  const [d, setD] = useState({ description: "", quantity: 1, uom: "ea" });
  return (
    <div className="card">
      <div className="bom-head">
        <h3>Line items ({rfq.items.length})</h3>
      </div>
      <div className="bom-table-wrap">
        <table className="bom-table">
          <thead>
            <tr>
              <th>Description</th>
              <th className="r">Qty</th>
              <th>UoM</th>
              <th className="r">Budget / unit</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rfq.items.map((it) => (
              <tr key={it.id}>
                <td>
                  <input
                    className="cell-text"
                    defaultValue={it.description}
                    key={it.description}
                    onBlur={(e) =>
                      e.target.value !== it.description &&
                      m.updateItem.mutate({ itemId: it.id, description: e.target.value })
                    }
                  />
                </td>
                <td className="r">
                  <input
                    className="r cell-num"
                    type="number"
                    step="any"
                    defaultValue={it.quantity}
                    key={it.quantity}
                    onBlur={(e) =>
                      Number(e.target.value) !== it.quantity &&
                      m.updateItem.mutate({ itemId: it.id, quantity: Number(e.target.value) })
                    }
                  />
                </td>
                <td>
                  <input
                    className="cell-text"
                    defaultValue={it.uom}
                    key={it.uom}
                    onBlur={(e) => e.target.value !== it.uom && m.updateItem.mutate({ itemId: it.id, uom: e.target.value })}
                  />
                </td>
                <td className="r muted">{it.targetCost != null ? money(it.targetCost, cur) : "—"}</td>
                <td>
                  <button className="icon-btn" onClick={() => m.removeItem.mutate(it.id)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="add-bom"
        onSubmit={(e) => {
          e.preventDefault();
          if (!d.description.trim()) return;
          m.addItem.mutate(d, { onSuccess: () => setD({ description: "", quantity: 1, uom: "ea" }) });
        }}
      >
        <input
          placeholder="Add a line item…"
          className="w-desc"
          value={d.description}
          onChange={(e) => setD({ ...d, description: e.target.value })}
        />
        <input
          type="number"
          step="any"
          min={0}
          className="w-qty"
          value={d.quantity}
          onChange={(e) => setD({ ...d, quantity: Number(e.target.value) })}
        />
        <input className="w-uom" value={d.uom} onChange={(e) => setD({ ...d, uom: e.target.value })} />
        <button className="btn primary sm">Add line</button>
      </form>
    </div>
  );
}

function SuppliersSection({ rfq, m }: { rfq: Rfq; m: M }) {
  const { data: all } = useSuppliers();
  const [picking, setPicking] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const onRfq = new Set(rfq.suppliers.map((s) => s.supplierId));
  const available = (all ?? []).filter((s) => !onRfq.has(s.id));
  const [sendResult, setSendResult] = useState<string | null>(null);

  const send = () =>
    m.send.mutate(
      { message: msg || undefined },
      {
        onSuccess: (r) =>
          setSendResult(
            r.mailEnabled
              ? `Sent ${r.sent.length} email(s).`
              : `SMTP not configured — ${r.sent.length} message(s) logged to the API console (portal links still work).`,
          ),
      },
    );

  return (
    <div className="card">
      <div className="bom-head">
        <h3>Suppliers ({rfq.suppliers.length})</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn sm" onClick={() => setPicking((p) => !p)}>
            {picking ? "Done" : "Add suppliers"}
          </button>
          <button
            className="btn primary sm"
            disabled={rfq.suppliers.length === 0 || rfq.items.length === 0 || m.send.isPending}
            onClick={send}
          >
            {m.send.isPending ? "Sending…" : "Send / resend RFQ"}
          </button>
        </div>
      </div>

      {sendResult && <p className="muted small">{sendResult}</p>}

      {picking && (
        <div className="picker">
          {available.length === 0 && <p className="muted small">All suppliers are already on this RFQ. Add more from the Suppliers page.</p>}
          {available.map((s) => (
            <label key={s.id} className="chk">
              <input
                type="checkbox"
                checked={sel.includes(s.id)}
                onChange={(e) => setSel(e.target.checked ? [...sel, s.id] : sel.filter((x) => x !== s.id))}
              />
              {s.name} <span className="muted xs">{s.trades.join(", ")}</span>
            </label>
          ))}
          {sel.length > 0 && (
            <button
              className="btn primary sm"
              onClick={() => m.addSuppliers.mutate(sel, { onSuccess: () => (setSel([]), setPicking(false)) })}
            >
              Add {sel.length}
            </button>
          )}
        </div>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Supplier</th>
            <th>Invite email</th>
            <th>Sent</th>
            <th>Viewed</th>
            <th>Responded</th>
            <th>Portal link</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rfq.suppliers.map((s) => (
            <tr key={s.id} className={s.awarded ? "awarded-row" : ""}>
              <td>
                {s.supplier.name}
                {s.awarded && <span className="pill rfq-AWARDED" style={{ marginLeft: 6 }}>awarded</span>}
              </td>
              <td className="muted">{s.email}</td>
              <td>{s.sentAt ? new Date(s.sentAt).toLocaleDateString() : "—"}</td>
              <td>{s.viewedAt ? "✓" : "—"}</td>
              <td>{s.respondedAt ? new Date(s.respondedAt).toLocaleDateString() : "—"}</td>
              <td>
                <button
                  className="btn sm"
                  onClick={() => navigator.clipboard?.writeText(`${location.origin}/portal/${s.token}`)}
                  title={`${location.origin}/portal/${s.token}`}
                >
                  Copy link
                </button>
              </td>
              <td>
                <button className="icon-btn" onClick={() => m.removeSupplier.mutate(s.id)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rfq.suppliers.length > 0 && (
        <label className="notes" style={{ marginTop: 8 }}>
          Cover message (optional, included in the email)
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} />
        </label>
      )}
    </div>
  );
}

function Comparison({ rfq, m, cur }: { rfq: Rfq; m: M; cur: string }) {
  const { comparison, suppliers, items } = rfq;
  if (suppliers.length === 0) return null;
  const totalByRs = new Map(comparison.supplierTotals.map((t) => [t.rfqSupplierId, t]));

  return (
    <div className="card">
      <div className="bom-head">
        <h3>Quote comparison</h3>
        <span className="muted small">extended = unit price × qty; lowest per line highlighted</span>
      </div>
      <div className="bom-table-wrap">
        <table className="bom-table compare-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="r">Qty</th>
              {suppliers.map((s) => (
                <th key={s.id} className="r">
                  {s.supplier.name}
                  {s.respondedAt ? "" : " *"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const line = comparison.byLine.find((l) => l.itemId === it.id);
              return (
                <tr key={it.id}>
                  <td>{it.description}</td>
                  <td className="r muted">
                    {it.quantity} {it.uom}
                  </td>
                  {suppliers.map((s) => {
                    const cell = line?.cells.find((c) => c.rfqSupplierId === s.id);
                    const low = cell?.extended != null && line?.lowest != null && cell.extended === line.lowest;
                    return (
                      <td key={s.id} className={`r ${low ? "low-cell" : ""}`}>
                        {cell?.extended != null ? (
                          <>
                            {money(cell.extended, cur)}
                            <div className="muted xs">@ {money(cell.unitPrice ?? 0, cur)}</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="strong">Total quoted</td>
              <td />
              {suppliers.map((s) => {
                const t = totalByRs.get(s.id);
                return (
                  <td key={s.id} className="r strong">
                    {t && t.quotedLines > 0 ? money(t.total, cur) : "—"}
                    {t && !t.complete && t.quotedLines > 0 && <div className="muted xs">{t.quotedLines}/{items.length} lines</div>}
                  </td>
                );
              })}
            </tr>
            <tr>
              <td className="muted xs">lead time</td>
              <td />
              {suppliers.map((s) => (
                <td key={s.id} className="r muted xs">
                  {s.leadTimeDays != null ? `${s.leadTimeDays} d` : "—"}
                </td>
              ))}
            </tr>
            <tr>
              <td />
              <td />
              {suppliers.map((s) => (
                <td key={s.id} className="r">
                  <button
                    className={`btn sm ${s.awarded ? "primary" : ""}`}
                    disabled={!s.respondedAt}
                    onClick={() => m.award.mutate(s.id)}
                  >
                    {s.awarded ? "Awarded" : "Award"}
                  </button>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="muted xs">* has not submitted a response yet</p>

      {suppliers.some((s) => s.attachments.length > 0) && (
        <>
          <h3 style={{ marginTop: 14 }}>Submitted documents</h3>
          <ul className="attach-list">
            {suppliers.flatMap((s) =>
              s.attachments.map((a) => (
                <li key={a.id}>
                  <a href={`/api/rfqs/${rfq.id}/attachments/${a.id}`} target="_blank" rel="noreferrer">
                    {a.filename}
                  </a>{" "}
                  <span className="muted xs">
                    {s.supplier.name} · {(a.size / 1024).toFixed(0)} KB · {new Date(a.uploadedAt).toLocaleDateString()}
                  </span>
                </li>
              )),
            )}
          </ul>
        </>
      )}
    </div>
  );
}
