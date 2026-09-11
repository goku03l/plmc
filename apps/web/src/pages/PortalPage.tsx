import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { money } from "../format";
import type { PortalView } from "../types";

export default function PortalPage() {
  const { token = "" } = useParams();
  const qc = useQueryClient();
  const key = ["portal", token];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api.get<PortalView>(`/portal/${token}`) });

  const [prices, setPrices] = useState<Record<string, string>>({});
  const [lineNotes, setLineNotes] = useState<Record<string, string>>({});
  const [lead, setLead] = useState("");
  const [notes, setNotes] = useState("");
  const seeded = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!data || seeded.current) return;
    seeded.current = true;
    setPrices(Object.fromEntries(data.items.map((i) => [i.id, i.unitPrice != null ? String(i.unitPrice) : ""])));
    setLineNotes(Object.fromEntries(data.items.map((i) => [i.id, i.lineNotes ?? ""])));
    setLead(data.leadTimeDays != null ? String(data.leadTimeDays) : "");
    setNotes(data.notes ?? "");
  }, [data]);

  const save = useMutation({
    mutationFn: (submit: boolean) =>
      api.post<PortalView>(`/portal/${token}`, {
        submit,
        leadTimeDays: lead === "" ? null : Number(lead),
        notes: notes || null,
        lines: (data?.items ?? []).map((i) => ({
          rfqItemId: i.id,
          unitPrice: prices[i.id] === "" || prices[i.id] == null ? 0 : Number(prices[i.id]),
          notes: lineNotes[i.id] || null,
        })),
      }),
    onSuccess: (d) => qc.setQueryData(key, d),
  });

  const upload = useMutation({
    mutationFn: (file: File) => api.upload<PortalView>(`/portal/${token}/files`, file),
    onSuccess: (d) => qc.setQueryData(key, d),
  });
  const removeFile = useMutation({
    mutationFn: (id: string) => api.del(`/portal/${token}/files/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  if (isLoading) return <div className="portal-wrap">Loading…</div>;
  if (error || !data)
    return (
      <div className="portal-wrap">
        <div className="card">
          <h2>Invitation not found</h2>
          <p className="muted">This link is invalid or has been withdrawn. Please contact the project team.</p>
        </div>
      </div>
    );

  const cur = data.currency;
  const runningTotal = data.items.reduce(
    (s, i) => s + (prices[i.id] ? Number(prices[i.id]) * i.quantity : 0),
    0,
  );

  return (
    <div className="portal-wrap">
      <header className="portal-head">
        <div>
          <div className="brand">
            <span className="brand-mark">▚</span> Supplier Portal
          </div>
          <h1>
            {data.rfq.number} — {data.rfq.title}
          </h1>
          <p className="muted">
            {data.rfq.project} · quoting as <strong>{data.supplier}</strong>
            {data.rfq.dueDate && <> · response due {new Date(data.rfq.dueDate).toLocaleDateString()}</>}
          </p>
        </div>
        <span className={`pill ${data.status === "SUBMITTED" ? "rfq-RESPONSES" : "rfq-SENT"}`}>
          {data.status === "SUBMITTED" ? "Submitted" : "Awaiting your quote"}
        </span>
      </header>

      {data.closed && <div className="card banner-warn">This RFQ is now closed. Your submission can no longer be changed.</div>}
      {data.rfq.scope && (
        <div className="card">
          <h3>Scope</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{data.rfq.scope}</p>
        </div>
      )}

      <div className="card">
        <h3>Your quotation</h3>
        <div className="bom-table-wrap">
          <table className="bom-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="r">Qty</th>
                <th>UoM</th>
                <th className="r">Unit price ({cur})</th>
                <th className="r">Line total</th>
                <th>Remark</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.description}</td>
                  <td className="r">{i.quantity}</td>
                  <td>{i.uom}</td>
                  <td className="r">
                    <input
                      className="r cell-num"
                      type="number"
                      min={0}
                      step="any"
                      disabled={data.closed}
                      value={prices[i.id] ?? ""}
                      onChange={(e) => setPrices({ ...prices, [i.id]: e.target.value })}
                    />
                  </td>
                  <td className="r">{prices[i.id] ? money(Number(prices[i.id]) * i.quantity, cur) : "—"}</td>
                  <td>
                    <input
                      className="cell-text"
                      disabled={data.closed}
                      value={lineNotes[i.id] ?? ""}
                      onChange={(e) => setLineNotes({ ...lineNotes, [i.id]: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="r strong">
                  Total
                </td>
                <td className="r strong">{money(runningTotal, cur)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="field-grid" style={{ marginTop: 10 }}>
          <label>
            Lead time (days)
            <input type="number" min={0} disabled={data.closed} value={lead} onChange={(e) => setLead(e.target.value)} />
          </label>
        </div>
        <label className="notes">
          Notes / clarifications
          <textarea disabled={data.closed} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {!data.closed && (
          <div className="form-actions">
            <button className="btn" disabled={save.isPending} onClick={() => save.mutate(false)}>
              Save draft
            </button>
            <button className="btn primary" disabled={save.isPending} onClick={() => save.mutate(true)}>
              {data.status === "SUBMITTED" ? "Update submission" : "Submit quotation"}
            </button>
            {save.isSuccess && <span className="muted small">Saved.</span>}
            {save.error && <span className="error small">{(save.error as Error).message}</span>}
          </div>
        )}
      </div>

      <div className="card">
        <div className="bom-head">
          <h3>Supporting documents</h3>
          {!data.closed && (
            <>
              <input
                ref={fileRef}
                type="file"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload.mutate(f);
                  e.target.value = "";
                }}
              />
              <button className="btn sm" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
                {upload.isPending ? "Uploading…" : "Upload file"}
              </button>
            </>
          )}
        </div>
        <ul className="attach-list">
          {data.attachments.map((a) => (
            <li key={a.id}>
              <a href={`/api/portal/${token}/files/${a.id}`} target="_blank" rel="noreferrer">
                {a.filename}
              </a>{" "}
              <span className="muted xs">
                {(a.size / 1024).toFixed(0)} KB · {new Date(a.uploadedAt).toLocaleDateString()}
              </span>
              {!data.closed && (
                <button className="icon-btn" onClick={() => removeFile.mutate(a.id)}>
                  ✕
                </button>
              )}
            </li>
          ))}
          {data.attachments.length === 0 && <li className="muted small">No files uploaded.</li>}
        </ul>
        {upload.error && <span className="error small">{(upload.error as Error).message}</span>}
      </div>
    </div>
  );
}
