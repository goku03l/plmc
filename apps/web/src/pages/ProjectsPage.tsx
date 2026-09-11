import { useState } from "react";
import { Link } from "react-router-dom";
import { useCreateProject, useProjects } from "../hooks";

export default function ProjectsPage() {
  const { data: projects, isLoading, error } = useProjects();
  const create = useCreateProject();
  const [form, setForm] = useState({ code: "", name: "", client: "", location: "", currency: "USD" });
  const [open, setOpen] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(form, {
      onSuccess: () => {
        setForm({ code: "", name: "", client: "", location: "", currency: "USD" });
        setOpen(false);
      },
    });
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Projects</h1>
        <button className="btn primary" onClick={() => setOpen((o) => !o)}>
          {open ? "Cancel" : "New project"}
        </button>
      </div>

      {open && (
        <form className="card form-grid" onSubmit={submit}>
          <label>
            Code
            <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="RIV-002" />
          </label>
          <label>
            Name
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Harbour Residences" />
          </label>
          <label>
            Client
            <input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
          </label>
          <label>
            Location
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </label>
          <label>
            Currency
            <input value={form.currency} maxLength={3} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
          </label>
          <div className="form-actions">
            <button className="btn primary" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create project"}
            </button>
            {create.error && <span className="error">{(create.error as Error).message}</span>}
          </div>
        </form>
      )}

      {isLoading && <p className="muted">Loading…</p>}
      {error && <p className="error">{(error as Error).message}</p>}

      <div className="project-grid">
        {projects?.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="card project-card">
            <div className="project-code">{p.code}</div>
            <div className="project-name">{p.name}</div>
            <div className="muted">{[p.client, p.location].filter(Boolean).join(" · ") || "—"}</div>
            <div className="project-meta">
              <span className={`pill status-${p.status}`}>{p.status}</span>
              <span className="muted">{p._count?.nodes ?? 0} nodes</span>
              <span className="muted">{p.currency}</span>
            </div>
          </Link>
        ))}
        {projects && projects.length === 0 && <p className="muted">No projects yet. Create one to get started.</p>}
      </div>

      <p className="muted small">
        Tip: run <code>npm run db:seed</code> for the “Riverside Office Tower” demo project.
      </p>
    </div>
  );
}
