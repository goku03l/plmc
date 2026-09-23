import { Link } from "react-router-dom";

const SCENARIOS = [
  {
    q: "“Raise an RFQ for the windows across all 24 apartments.”",
    a: "Summer gathers every matching BOM line across the towers, totals the quantity, and sends one RFQ to your window vendors — not twenty-four.",
  },
  {
    q: "“What's blocking the Tower 2 pour this week?”",
    a: "It checks stock across every warehouse against the BOM, nets out what's already covered, and tells you exactly what's short before it stalls the crew.",
  },
  {
    q: "“Who quoted lowest on the steel RFQ, and can they deliver by the 30th?”",
    a: "It reads the supplier responses, compares price and lead time, and gives you a straight answer — in English, हिन्दी or தமிழ், typed or spoken.",
  },
];

const PILLARS = [
  { label: "DMU project structure", detail: "towers, floors, units — instanced, not duplicated" },
  { label: "Bill of materials", detail: "cost, wastage and labour roll up automatically" },
  { label: "Procurement", detail: "RFQs, supplier comparison, a no-login quote portal" },
  { label: "Inventory", detail: "multi-warehouse stock, shortfall-aware" },
  { label: "Documents", detail: "drawings and spec sheets attached to any node" },
];

export default function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-topbar">
        <div className="brand">
          <span className="brand-mark">▚</span> Summer
        </div>
        <Link to="/projects" className="btn primary sm">
          Open workspace
        </Link>
      </header>

      <section className="landing-hero">
        <p className="landing-eyebrow">An AI assistant for construction, not another PDM tool</p>
        <h1 className="landing-title">
          Meet Summer — the assistant for people running too many projects at once.
        </h1>
        <p className="landing-lede">
          If you're juggling towers, crews, vendors and a dozen open RFQs in your head, Summer
          carries that load with you. It knows your projects, does the busywork, and plans ahead
          — so you spend less time chasing numbers and more time building.
        </p>
        <div className="landing-cta">
          <Link to="/projects" className="btn primary">
            Open workspace →
          </Link>
          <Link to="/assistant" className="btn ghost">
            Talk to Summer
          </Link>
        </div>
      </section>

      <section className="landing-scenarios">
        <h2 className="landing-section-title">Ask it like you'd ask a person</h2>
        <div className="scenario-grid">
          {SCENARIOS.map((s) => (
            <div className="card scenario-card" key={s.q}>
              <p className="scenario-q">{s.q}</p>
              <p className="scenario-a muted">{s.a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-pillars">
        <h2 className="landing-section-title">Everything Summer keeps track of</h2>
        <div className="pillar-grid">
          {PILLARS.map((p) => (
            <div className="pillar" key={p.label}>
              <div className="pillar-label">{p.label}</div>
              <div className="pillar-detail muted small">{p.detail}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="landing-footer">
        <Link to="/projects" className="btn primary">
          Open workspace →
        </Link>
      </footer>
    </div>
  );
}
