import type { Category, CostSummary as Summary } from "../types";
import { money } from "../format";

export default function CostSummary({ summary, categories }: { summary: Summary; categories: Category[] }) {
  const colorFor = (id: string | null) => categories.find((c) => c.id === id)?.color ?? "#94a3b8";
  const max = Math.max(1, ...summary.byCategory.map((r) => r.amount));

  return (
    <div className="card summary">
      <div className="summary-totals">
        <Stat label="Total estimated cost" value={money(summary.total, summary.currency)} big />
        {summary.byKind
          .filter((k) => k.amount > 0 || k.kind === "MATERIAL" || k.kind === "LABOR")
          .map((k) => (
            <Stat key={k.kind} label={k.label} value={money(k.amount, summary.currency)} />
          ))}
        <Stat label="Structure nodes" value={String(summary.nodeCount)} />
      </div>
      <div className="summary-bars">
        {summary.byCategory.map((r) => (
          <div key={r.categoryId ?? "none"} className="bar-row">
            <span className="bar-label">{r.label}</span>
            <span className="bar-track">
              <span
                className="bar-fill"
                style={{ width: `${(r.amount / max) * 100}%`, background: colorFor(r.categoryId) }}
              />
            </span>
            <span className="bar-value">{money(r.amount, summary.currency)}</span>
          </div>
        ))}
        {summary.byCategory.length === 0 && <p className="muted small">Add BOM lines to see a cost breakdown.</p>}
      </div>
    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className={`stat ${big ? "stat-big" : ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
