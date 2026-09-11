import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { BomLine, BomLineKind, Category, NodeAttachment, NodeType } from "../types";
import { BOM_LINE_KINDS, BOM_LINE_KIND_LABEL } from "../types";
import {
  useBomMutations,
  useMaterials,
  useMaterialSuppliers,
  useNode,
  useNodeAttachmentMutations,
  useNodeMutations,
  useRfqMutations,
  useRfqs,
  useSuppliers,
} from "../hooks";
import { money } from "../format";
import { STATUS_LABEL } from "../pages/RfqsPage";

const TYPES: NodeType[] = ["GROUP", "SUBGROUP", "ASSEMBLY", "COMPONENT"];

export function lineTotal(l: Pick<BomLine, "kind" | "quantity" | "unitCost" | "wastagePct" | "laborCost">) {
  if (l.kind !== "MATERIAL") return l.quantity * l.unitCost;
  return l.quantity * l.unitCost * (1 + l.wastagePct / 100) + l.quantity * l.laborCost;
}

export default function NodeDetail({
  projectId,
  nodeId,
  categories,
  currency,
  onDeleted,
}: {
  projectId: string;
  nodeId: string | null;
  categories: Category[];
  currency: string;
  onDeleted: () => void;
}) {
  const { data: node, isLoading } = useNode(nodeId);
  const nodeM = useNodeMutations(projectId);
  const bomM = useBomMutations(projectId, nodeId);

  if (!nodeId) return <div className="empty">Select a node in the tree to view its details and Bill of Materials.</div>;
  if (isLoading || !node) return <div className="muted">Loading node…</div>;

  const bomDirect = node.bomLines.reduce((s, l) => s + lineTotal(l), 0);

  return (
    <div className="node-detail">
      <div className="pane-head">
        <input
          className="node-title-input"
          defaultValue={node.name}
          key={node.id + node.name}
          onBlur={(e) => e.target.value !== node.name && nodeM.update.mutate({ id: node.id, name: e.target.value })}
        />
        <button
          className="btn danger sm"
          onClick={() => {
            if (confirm(`Delete “${node.name}” and everything under it?`)) {
              nodeM.remove.mutate(node.id, { onSuccess: onDeleted });
            }
          }}
        >
          Delete node
        </button>
      </div>

      <div className="field-grid">
        <label>
          Type
          <select
            value={node.type}
            onChange={(e) => nodeM.update.mutate({ id: node.id, type: e.target.value })}
          >
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Sub-group / category
          <select
            value={node.categoryId ?? ""}
            onChange={(e) => nodeM.update.mutate({ id: node.id, categoryId: e.target.value || null })}
          >
            <option value="">— none —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quantity
          <input
            type="number"
            min={0}
            step="any"
            defaultValue={node.quantity}
            key={node.id + node.quantity}
            onBlur={(e) =>
              Number(e.target.value) !== node.quantity &&
              nodeM.update.mutate({ id: node.id, quantity: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Unit of measure
          <input
            defaultValue={node.uom}
            key={node.id + node.uom}
            onBlur={(e) => e.target.value !== node.uom && nodeM.update.mutate({ id: node.id, uom: e.target.value })}
          />
        </label>
        <label>
          Reference code
          <input
            defaultValue={node.refCode ?? ""}
            key={node.id + (node.refCode ?? "")}
            onBlur={(e) =>
              e.target.value !== (node.refCode ?? "") &&
              nodeM.update.mutate({ id: node.id, refCode: e.target.value || null })
            }
          />
        </label>
      </div>

      <label className="notes">
        Notes / construction detail
        <textarea
          defaultValue={node.notes ?? ""}
          key={node.id + (node.notes ?? "")}
          onBlur={(e) =>
            e.target.value !== (node.notes ?? "") && nodeM.update.mutate({ id: node.id, notes: e.target.value || null })
          }
        />
      </label>

      <div className="bom-head">
        <h3>Bill of Materials</h3>
        <span className="muted small">direct cost of this node: {money(bomDirect, currency)}</span>
      </div>

      <BomEditor
        lines={node.bomLines}
        currency={currency}
        onAdd={(d) => bomM.add.mutate(d)}
        onUpdate={(id, d) => bomM.update.mutate({ id, ...d })}
        onRemove={(id) => bomM.remove.mutate(id)}
      />

      <DocumentsPanel nodeId={node.id} attachments={node.attachments} />

      <RfqPanel projectId={projectId} nodeId={node.id} nodeName={node.name} />
    </div>
  );
}

const FILE_ICON: Record<string, string> = {
  dwg: "📐",
  dxf: "📐",
  skp: "📐",
  ifc: "🏗️",
  pdf: "📄",
  doc: "📄",
  docx: "📄",
  xls: "📊",
  xlsx: "📊",
  jpg: "🖼️",
  jpeg: "🖼️",
  png: "🖼️",
  gif: "🖼️",
  webp: "🖼️",
  zip: "🗜️",
  rar: "🗜️",
};
const fileIcon = (name: string) => FILE_ICON[name.split(".").pop()?.toLowerCase() ?? ""] ?? "📎";
const fileSize = (bytes: number) => (bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** PDM-style documents: drawings, photos, PDFs — any file type, no restriction. */
function DocumentsPanel({ nodeId, attachments }: { nodeId: string; attachments: NodeAttachment[] }) {
  const m = useNodeAttachmentMutations(nodeId);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="docs-panel">
      <div className="bom-head">
        <h3>Documents</h3>
        <div>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              for (const f of Array.from(e.target.files ?? [])) m.upload.mutate(f);
              e.target.value = "";
            }}
          />
          <button className="btn sm" disabled={m.upload.isPending} onClick={() => fileRef.current?.click()}>
            {m.upload.isPending ? "Uploading…" : "+ Add file(s)"}
          </button>
        </div>
      </div>
      <ul className="attach-list">
        {attachments.map((a) => (
          <li key={a.id}>
            <span aria-hidden>{fileIcon(a.filename)}</span>
            <a href={`/api/nodes/${nodeId}/attachments/${a.id}`} target="_blank" rel="noreferrer">
              {a.filename}
            </a>
            <span className="muted xs">
              {fileSize(a.size)} · {new Date(a.uploadedAt).toLocaleDateString()}
            </span>
            <button className="icon-btn" title="Remove" onClick={() => m.remove.mutate(a.id)}>
              ✕
            </button>
          </li>
        ))}
        {attachments.length === 0 && <li className="muted small">No documents attached yet — drawings, photos, PDFs, anything.</li>}
      </ul>
      {m.upload.error && <span className="error small">{(m.upload.error as Error).message}</span>}
    </div>
  );
}

function RfqPanel({ projectId, nodeId, nodeName }: { projectId: string; nodeId: string; nodeName: string }) {
  const { data: rfqs } = useRfqs({ nodeId });
  const m = useRfqMutations();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");

  return (
    <div className="rfq-panel">
      <div className="bom-head">
        <h3>RFQs for this node</h3>
      </div>
      {rfqs && rfqs.length > 0 && (
        <ul className="rfq-mini-list">
          {rfqs.map((r) => {
            const responded = r.suppliers.filter((s) => s.respondedAt).length;
            return (
              <li key={r.id}>
                <Link to={`/rfqs/${r.id}`} className="mono">
                  {r.number}
                </Link>{" "}
                {r.title}
                <span className="muted xs">
                  {" "}
                  · {r._count.suppliers} suppliers · {responded} responded
                </span>
                <span className={`pill rfq-${r.status}`}>{STATUS_LABEL[r.status]}</span>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="add-bom"
        onSubmit={(e) => {
          e.preventDefault();
          const t = title.trim() || `${nodeName} — supply & install`;
          m.create.mutate(
            { projectId, nodeId, title: t, fromNodeBom: true },
            { onSuccess: (r) => navigate(`/rfqs/${r.id}`) },
          );
        }}
      >
        <input
          className="w-desc"
          placeholder={`RFQ title (default: “${nodeName} — supply & install”)`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="btn primary sm" disabled={m.create.isPending}>
          Create RFQ from this node
        </button>
      </form>
    </div>
  );
}

function BomEditor({
  lines,
  currency,
  onAdd,
  onUpdate,
  onRemove,
}: {
  lines: BomLine[];
  currency: string;
  onAdd: (d: Record<string, unknown>) => void;
  onUpdate: (id: string, d: Record<string, unknown>) => void;
  onRemove: (id: string) => void;
}) {
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);
  return (
    <div className="bom-table-wrap">
      <table className="bom-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="r">Qty</th>
            <th>UoM</th>
            <th className="r">Unit cost</th>
            <th className="r">Waste %</th>
            <th className="r">Labour/unit</th>
            <th className="r">Line total</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <BomRow key={l.id} line={l} currency={currency} onUpdate={onUpdate} onRemove={onRemove} />
          ))}
          {lines.length === 0 && (
            <tr>
              <td colSpan={8} className="muted center">
                No BOM lines yet.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} className="r strong">
              BOM total (this node)
            </td>
            <td className="r strong">{money(total, currency)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <AddBomLine onAdd={onAdd} />
    </div>
  );
}

function SupplierPicker({
  line,
  onUpdate,
}: {
  line: BomLine;
  onUpdate: (id: string, d: Record<string, unknown>) => void;
}) {
  const { data: links } = useMaterialSuppliers(line.materialId ?? null);
  const { data: all } = useSuppliers();

  // linked suppliers first (preferred flagged), then the rest of the directory
  const linkedIds = new Set(links?.map((l) => l.supplierId));
  const rest = (all ?? []).filter((s) => !linkedIds.has(s.id));

  return (
    <select
      className={`supplier-select ${line.supplierId ? "has-supplier" : ""}`}
      value={line.supplierId ?? ""}
      onChange={(e) => onUpdate(line.id, { supplierId: e.target.value || null })}
      title="Supplier furnishing this line"
    >
      <option value="">— no supplier —</option>
      {links && links.length > 0 && (
        <optgroup label={line.material ? `Linked to ${line.material.code}` : "Linked"}>
          {links.map((l) => (
            <option key={l.supplierId} value={l.supplierId}>
              {l.preferred ? "★ " : ""}
              {l.supplier.name}
            </option>
          ))}
        </optgroup>
      )}
      {rest.length > 0 && (
        <optgroup label="All suppliers">
          {rest.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

function BomRow({
  line,
  currency,
  onUpdate,
  onRemove,
}: {
  line: BomLine;
  currency: string;
  onUpdate: (id: string, d: Record<string, unknown>) => void;
  onRemove: (id: string) => void;
}) {
  const cell = (field: keyof BomLine, numeric = true) => (
    <input
      className={numeric ? "r cell-num" : "cell-text"}
      type={numeric ? "number" : "text"}
      step="any"
      min={numeric ? 0 : undefined}
      defaultValue={line[field] as string | number}
      key={line.id + field + String(line[field])}
      onBlur={(e) => {
        const v = numeric ? Number(e.target.value) : e.target.value;
        if (v !== line[field]) onUpdate(line.id, { [field]: v });
      }}
    />
  );

  const material = line.kind === "MATERIAL";

  return (
    <tr>
      <td>
        {cell("description", false)}
        <div className="line-meta">
          <select
            className={`kind-select k-${line.kind}`}
            value={line.kind}
            onChange={(e) => onUpdate(line.id, { kind: e.target.value })}
            title="Cost kind"
          >
            {BOM_LINE_KINDS.map((k) => (
              <option key={k} value={k}>
                {BOM_LINE_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          {line.material && <span className="muted xs">{line.material.code}</span>}
        </div>
        <SupplierPicker line={line} onUpdate={onUpdate} />
      </td>
      <td className="r">{cell("quantity")}</td>
      <td>{cell("uom", false)}</td>
      <td className="r">{cell("unitCost")}</td>
      <td className="r">{material ? cell("wastagePct") : <span className="muted">—</span>}</td>
      <td className="r">{material ? cell("laborCost") : <span className="muted">—</span>}</td>
      <td className="r strong">{money(lineTotal(line), currency)}</td>
      <td>
        <button className="icon-btn" title="Remove" onClick={() => onRemove(line.id)}>
          ✕
        </button>
      </td>
    </tr>
  );
}

function AddBomLine({ onAdd }: { onAdd: (d: Record<string, unknown>) => void }) {
  const [kind, setKind] = useState<BomLineKind>("MATERIAL");
  const [q, setQ] = useState("");
  const { data: materials } = useMaterials(q);
  const [sel, setSel] = useState("");
  const [qty, setQty] = useState(1);
  const [uom, setUom] = useState("");
  const [rate, setRate] = useState(0);
  const [desc, setDesc] = useState("");
  const [labor, setLabor] = useState(0);

  const isMaterial = kind === "MATERIAL";

  useEffect(() => {
    const m = materials?.find((x) => x.id === sel);
    if (m) {
      setDesc(m.name);
      setUom(m.uom);
      setRate(m.unitCost);
    }
  }, [sel, materials]);

  useEffect(() => {
    if (kind !== "MATERIAL") {
      setSel("");
      setQ("");
      setLabor(0);
    }
  }, [kind]);

  const reset = () => {
    setSel("");
    setDesc("");
    setQty(1);
    setUom("");
    setRate(0);
    setLabor(0);
    setQ("");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isMaterial ? !sel && !desc.trim() : !desc.trim()) return;
    onAdd({
      kind,
      materialId: isMaterial && sel ? sel : null,
      description: desc.trim() || undefined,
      quantity: qty,
      uom: uom || undefined,
      unitCost: isMaterial && sel ? undefined : rate,
      laborCost: isMaterial ? labor : 0,
    });
    reset();
  };

  return (
    <form className="add-bom" onSubmit={submit}>
      <select value={kind} onChange={(e) => setKind(e.target.value as BomLineKind)} title="Cost kind">
        {BOM_LINE_KINDS.map((k) => (
          <option key={k} value={k}>
            {BOM_LINE_KIND_LABEL[k]}
          </option>
        ))}
      </select>
      {isMaterial && (
        <>
          <input placeholder="Search catalog…" value={q} onChange={(e) => setQ(e.target.value)} className="w-search" />
          <select value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="">— ad-hoc item —</option>
            {materials?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.code}) · {money(m.unitCost)}/{m.uom}
              </option>
            ))}
          </select>
        </>
      )}
      <input
        placeholder={isMaterial ? "Description" : "e.g. Site transportation & logistics"}
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        className="w-desc"
      />
      <input
        type="number"
        min={0}
        step="any"
        value={qty}
        onChange={(e) => setQty(Number(e.target.value))}
        className="w-qty"
        title="Quantity"
      />
      <input value={uom} onChange={(e) => setUom(e.target.value)} className="w-uom" placeholder="uom" title="Unit of measure" />
      {(!isMaterial || !sel) && (
        <input
          type="number"
          min={0}
          step="any"
          value={rate}
          onChange={(e) => setRate(Number(e.target.value))}
          className="w-qty"
          title={isMaterial ? "Unit cost" : "Rate / lump sum"}
          placeholder="rate"
        />
      )}
      {isMaterial && (
        <input
          type="number"
          min={0}
          step="any"
          value={labor}
          onChange={(e) => setLabor(Number(e.target.value))}
          className="w-qty"
          title="Labour per unit"
          placeholder="labour"
        />
      )}
      <button className="btn primary sm">Add line</button>
    </form>
  );
}
