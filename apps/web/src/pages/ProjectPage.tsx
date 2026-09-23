import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useCategories, useProjectSummary, useProjectTree } from "../hooks";
import CostSummary from "../components/CostSummary";
import Tree from "../components/Tree";
import NodeDetail from "../components/NodeDetail";
import CategoryManager from "../components/CategoryManager";

export default function ProjectPage() {
  const { projectId = "" } = useParams();
  const tree = useProjectTree(projectId);
  const summary = useProjectSummary(projectId);
  const categories = useCategories(projectId);
  const [selected, setSelected] = useState<string | null>(null);
  const [showCats, setShowCats] = useState(false);

  if (tree.isLoading) return <p className="muted page">Loading project…</p>;
  if (tree.error) return <p className="error page">{(tree.error as Error).message}</p>;

  const project = tree.data!.project;
  const currency = summary.data?.currency ?? project.currency;

  return (
    <div className="page project-page">
      <div className="page-head">
        <div>
          <Link to="/projects" className="muted small">
            ← Projects
          </Link>
          <h1>
            <span className="muted">{project.code}</span> {project.name}
          </h1>
          <p className="muted small">{[project.client, project.location].filter(Boolean).join(" · ")}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="btn" to={`/projects/${projectId}/procurement`}>
            Supplier assignments
          </Link>
          <button className="btn" onClick={() => setShowCats((s) => !s)}>
            {showCats ? "Hide" : "Configure"} sub-groups
          </button>
        </div>
      </div>

      {summary.data && <CostSummary summary={summary.data} categories={categories.data ?? []} />}

      {showCats && <CategoryManager projectId={projectId} categories={categories.data ?? []} />}

      <div className="workspace">
        <div className="tree-pane card">
          <div className="pane-head">
            <h2>Project structure (DMU)</h2>
          </div>
          <Tree
            projectId={projectId}
            nodes={tree.data!.tree}
            categories={categories.data ?? []}
            currency={currency}
            selectedId={selected}
            onSelect={setSelected}
          />
        </div>
        <div className="detail-pane card">
          <NodeDetail
            projectId={projectId}
            nodeId={selected}
            categories={categories.data ?? []}
            currency={currency}
            onDeleted={() => setSelected(null)}
          />
        </div>
      </div>
    </div>
  );
}
