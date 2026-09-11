import { useState } from "react";
import type { Supplier, SupplierContact } from "../types";
import { useSupplierMutations, useSuppliers } from "../hooks";

type ContactDraft = Pick<SupplierContact, "name" | "email" | "phone" | "role" | "isPrimary">;
const emptyContact: ContactDraft = { name: "", email: "", phone: "", role: "", isPrimary: false };
const emptySupplier = {
  name: "",
  legalName: "",
  gstin: "",
  trades: "",
  email: "",
  phone: "",
  city: "",
  address: "",
  website: "",
  notes: "",
};

export default function SuppliersPage() {
  const [q, setQ] = useState("");
  const { data: suppliers, isLoading } = useSuppliers(q);
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Suppliers</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn primary" onClick={() => setEditing("new")}>
            New supplier
          </button>
        </div>
      </div>

      {editing && <SupplierForm supplier={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}

      {isLoading && <p className="muted">Loading…</p>}
      <div className="supplier-grid">
        {suppliers?.map((s) => (
          <button key={s.id} className="card supplier-card" onClick={() => setEditing(s)}>
            <div className="supplier-name">{s.name}</div>
            <div className="muted small">{[s.city, s.gstin].filter(Boolean).join(" · ") || "—"}</div>
            <div className="chips">
              {s.trades.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
            <div className="muted xs">
              {s.contacts.length} contact{s.contacts.length === 1 ? "" : "s"} · {s._count?.rfqInvites ?? 0} RFQs ·{" "}
              {s._count?.materialLinks ?? 0} materials
            </div>
          </button>
        ))}
        {suppliers && suppliers.length === 0 && <p className="muted">No suppliers yet.</p>}
      </div>
    </div>
  );
}

function SupplierForm({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const m = useSupplierMutations();
  const [f, setF] = useState(
    supplier
      ? {
          name: supplier.name,
          legalName: supplier.legalName ?? "",
          gstin: supplier.gstin ?? "",
          trades: supplier.trades.join(", "),
          email: supplier.email ?? "",
          phone: supplier.phone ?? "",
          city: supplier.city ?? "",
          address: supplier.address ?? "",
          website: supplier.website ?? "",
          notes: supplier.notes ?? "",
        }
      : emptySupplier,
  );
  const [contacts, setContacts] = useState<ContactDraft[]>(
    supplier?.contacts.map((c) => ({
      name: c.name,
      email: c.email,
      phone: c.phone ?? "",
      role: c.role ?? "",
      isPrimary: c.isPrimary,
    })) ?? [{ ...emptyContact, isPrimary: true }],
  );

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });
  const setContact = (i: number, patch: Partial<ContactDraft>) =>
    setContacts(contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      ...f,
      trades: f.trades
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      contacts: contacts.filter((c) => c.name.trim() && c.email.trim()),
    };
    const opts = { onSuccess: onClose };
    if (supplier) m.update.mutate({ id: supplier.id, ...body }, opts);
    else m.create.mutate(body, opts);
  };

  return (
    <form className="card form-grid supplier-form" onSubmit={submit}>
      <label>
        Name<input required value={f.name} onChange={set("name")} />
      </label>
      <label>
        Legal name<input value={f.legalName} onChange={set("legalName")} />
      </label>
      <label>
        GSTIN<input value={f.gstin} onChange={set("gstin")} />
      </label>
      <label>
        Trades (comma-separated)<input value={f.trades} onChange={set("trades")} placeholder="Concrete, Steel, Joinery" />
      </label>
      <label>
        Fallback email<input type="email" value={f.email} onChange={set("email")} />
      </label>
      <label>
        Phone<input value={f.phone} onChange={set("phone")} />
      </label>
      <label>
        City<input value={f.city} onChange={set("city")} />
      </label>
      <label>
        Website<input value={f.website} onChange={set("website")} />
      </label>
      <label className="wide">
        Address<input value={f.address} onChange={set("address")} />
      </label>
      <label className="wide">
        Notes<textarea value={f.notes} onChange={set("notes")} />
      </label>

      <div className="wide">
        <div className="bom-head">
          <h3>Contacts</h3>
          <button type="button" className="btn sm" onClick={() => setContacts([...contacts, { ...emptyContact }])}>
            + contact
          </button>
        </div>
        {contacts.map((c, i) => (
          <div key={i} className="contact-row">
            <input placeholder="Name" value={c.name} onChange={(e) => setContact(i, { name: e.target.value })} />
            <input placeholder="Email" type="email" value={c.email} onChange={(e) => setContact(i, { email: e.target.value })} />
            <input placeholder="Phone" value={c.phone ?? ""} onChange={(e) => setContact(i, { phone: e.target.value })} />
            <input placeholder="Role" value={c.role ?? ""} onChange={(e) => setContact(i, { role: e.target.value })} />
            <label className="chk" title="Primary contact — RFQs go here">
              <input
                type="radio"
                name="primaryContact"
                checked={c.isPrimary}
                onChange={() => setContacts(contacts.map((x, j) => ({ ...x, isPrimary: j === i })))}
              />
              primary
            </label>
            <button type="button" className="icon-btn" onClick={() => setContacts(contacts.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="form-actions wide">
        <button className="btn primary" disabled={m.create.isPending || m.update.isPending}>
          {supplier ? "Save supplier" : "Create supplier"}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        {supplier && (
          <button
            type="button"
            className="btn danger"
            onClick={() => confirm(`Delete ${supplier.name}?`) && m.remove.mutate(supplier.id, { onSuccess: onClose })}
          >
            Delete
          </button>
        )}
        {(m.create.error || m.update.error) && (
          <span className="error">{((m.create.error || m.update.error) as Error).message}</span>
        )}
      </div>
    </form>
  );
}
