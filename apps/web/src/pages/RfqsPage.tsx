import { Link } from "react-router-dom";
import { useRfqs } from "../hooks";
import type { RfqStatus } from "../types";

export const STATUS_LABEL: Record<RfqStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  RESPONSES: "Responses in",
  AWARDED: "Awarded",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export default function RfqsPage() {
  const { data: rfqs, isLoading } = useRfqs();

  return (
    <div className="page">
      <div className="page-head">
        <h1>RFQs</h1>
      </div>
      {isLoading && <p className="muted">Loading…</p>}
      <table className="data-table card">
        <thead>
          <tr>
            <th>Number</th>
            <th>Title</th>
            <th>Node</th>
            <th className="r">Items</th>
            <th className="r">Suppliers</th>
            <th className="r">Responded</th>
            <th>Due</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rfqs?.map((r) => {
            const responded = r.suppliers.filter((s) => s.respondedAt).length;
            return (
              <tr key={r.id}>
                <td className="mono">
                  <Link to={`/rfqs/${r.id}`}>{r.number}</Link>
                </td>
                <td>{r.title}</td>
                <td className="muted">{r.node?.name ?? "—"}</td>
                <td className="r">{r._count.items}</td>
                <td className="r">{r._count.suppliers}</td>
                <td className="r">{responded}</td>
                <td className="muted">{r.dueDate ? new Date(r.dueDate).toLocaleDateString() : "—"}</td>
                <td>
                  <span className={`pill rfq-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                </td>
              </tr>
            );
          })}
          {rfqs && rfqs.length === 0 && (
            <tr>
              <td colSpan={8} className="muted center">
                No RFQs yet — open a project node and “Create RFQ from this node”.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
