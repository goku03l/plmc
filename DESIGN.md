# PLMC — Design

PLM/BOM for construction. This document covers the domain model, architecture,
the reasoning behind each decision, and the roadmap beyond the MVP.

## 1. Problem framing

Construction estimating and delivery needs the same primitives that mechanical PLM
gives a product:

- a **product structure / DMU** — a hierarchy that decomposes the deliverable
  (building) into groups, systems, assemblies and components;
- a **BOM attached to that structure** — what each node is actually made of, with
  quantities and cost;
- **configurability** — every project organises its scope differently
  (Interiors / Exteriors / MEP / Structure / Sitework / Landscaping / …), so the
  classification must be data, not code;
- **roll-up** — cost and quantity must aggregate up the tree to a project total,
  and break down by sub-group.

The MVP delivers exactly this loop: create project → configure sub-groups → build
the structure tree → attach BOM lines (from a catalog or ad-hoc) → see live cost
roll-up and a by-sub-group breakdown.

## 2. Domain model

```
Project ──1:N── Category        (configurable sub-groups, project-scoped)
   │
   └────1:N── Node  ◄─┐         self-referencing tree  (the DMU)
                 │    │ parentId
                 │    └─────────┘
                 ├── categoryId ─► Category   (nearest category = cost bucket)
                 └──1:N── BomLine
                              └── materialId ─► Material   (optional catalog link)
```

### Project

Root object. Holds currency, status, client/location metadata. Deleting a project
cascades to its categories, nodes and BOM lines.

### Category — "configurable sub-groups"

A project-scoped classification (`key`, `label`, `color`, `sortOrder`). Seeded with
five sensible defaults on project creation but fully editable. A `Node` may point at
one category; the cost breakdown attributes a node to its **nearest** category
(itself, else the closest ancestor that has one), so you can tag just the top
"Interiors" group and everything beneath inherits the bucket.

Why project-scoped rather than global: two projects rarely agree on scope
breakdown, and a global taxonomy becomes a governance bottleneck. A global
"standard library" of categories that a project copies from is a later addition.

### Node — the DMU tree

Self-referencing (`parentId`) so the hierarchy is arbitrary depth. Fields:

| field        | purpose                                                          |
| ------------ | --------------------------------------------------------------- |
| `type`       | `GROUP` / `SUBGROUP` / `ASSEMBLY` / `COMPONENT` — advisory, drives UI affordances, not rules (kept permissive for the MVP) |
| `quantity` + `uom` | how many of this subtree the parent contains → drives quantity explosion in the roll-up |
| `categoryId` | sub-group classification                                         |
| `refCode`    | user reference / spec tag / CBS code                             |
| `attributes` (JSONB) | free-form construction detail — phase, trade, spec refs, location |

`onDelete: Cascade` on the self-relation: deleting a node removes its whole subtree.
Move is a dedicated endpoint (`POST /nodes/:id/move`) with a server-side cycle
check.

Ordering is an integer `sortOrder` with gaps of 10, so a single-row update can
reorder siblings without renumbering.

### Material — the catalog

Reusable resource definitions (`code`, `name`, `category`, `uom`, `unitCost`,
`wastagePct`, `spec` JSONB). Global in the MVP. A BOM line **snapshots** the
material's cost at the moment it is added and remains independently editable —
updating the catalog does not silently rewrite historical estimates. A future
"sync from catalog" action makes re-pricing explicit.

### BomLine — the BOM, attached to a node

The BOM is not a separate document; it is the set of `BomLine` rows hanging off a
`Node`. Each line: `quantity`, `uom`, `unitCost`, `wastagePct`, `laborCost`
(per unit), `constructionDetail` (JSONB), optional `materialId`. Lines with no
material are valid (ad-hoc items).

## 3. Cost model

Per line:

```
materialCost = quantity × unitCost × (1 + wastagePct/100)
labourCost   = quantity × laborCost
lineTotal    = materialCost + labourCost
```

Per node (recursive):

```
directCost   = Σ lineTotal over the node's own BOM        (one instance)
subtotal     = directCost + Σ child.rolledCost
rolledCost   = node.quantity × subtotal                   (what the parent sees)
```

Project total = Σ `rolledCost` of top-level nodes.

Roll-up is computed on read (`GET /projects/:id/tree` and `/summary`) from a single
`findMany` of all project nodes + their lines, then an in-memory tree walk
(`src/cost.ts`). For MVP-scale trees (hundreds–low-thousands of nodes) this is
sub-millisecond and always consistent. If trees grow large, the same function
moves behind a cache keyed on project `updatedAt`, or into a materialised
`node_cost` table refreshed on write.

**By-sub-group breakdown**: each node's extended direct cost
(`directCost × Π quantities of self and ancestors`) is attributed to its nearest
category. The rows sum exactly to the project total.

## 4. Architecture

```
┌──────────────┐      /api (proxied in dev)      ┌───────────────┐
│  web (Vite)  │ ─────────────────────────────►  │  api (Fastify) │
│  React SPA   │ ◄─────────  JSON  ────────────  │   + Prisma     │
└──────────────┘                                 └───────┬───────┘
                                                         │ SQL
                                                 ┌───────▼───────┐
                                                 │  PostgreSQL   │
                                                 └───────────────┘
```

**Monorepo** (npm workspaces): `apps/api`, `apps/web`. Shared types are currently
duplicated (`apps/web/src/types.ts` mirrors the Prisma shapes); a `packages/shared`
with generated Zod/TS types is the next refactor once the schema settles.

**API** — Fastify 5, ESM, run with `tsx` (no build step in the MVP). One route
module per aggregate. Zod validates every request body; a single error handler maps
`ZodError` → 400, `HttpError` → its status, Prisma `P2002/P2025` → 409/404.

**Frontend** — React + Vite. TanStack Query owns all server state and cache
invalidation (mutations invalidate `tree` / `summary` / `node` keys). React Router
for `/`, `/projects/:id`, `/materials`. No component library — a single `styles.css`
keeps the surface small and the look consistent (engineering-tool aesthetic:
compact, tabular numerals, inline editing).

**Why this stack**

- _Postgres + Prisma_: the data is deeply relational (recursive trees, FKs,
  cascades) and needs transactional integrity — a document store would fight this.
  Prisma gives typed access, painless migrations, and Studio for inspection.
- _Fastify over NestJS_: the API is CRUD + one compute (`cost.ts`). Fastify keeps
  the code readable and the dependency surface minimal; NestJS's module/DI
  machinery would be overhead at this size. The route-module split leaves room to
  grow.
- _TanStack Query_: eliminates hand-rolled cache/refetch logic; roll-up always
  reflects the latest write.

## 5. Cloud deployment

| Component | Target                                                                 |
| --------- | --------------------------------------------------------------------- |
| Database  | Managed Postgres — RDS, Cloud SQL, Neon, or Supabase                 |
| API       | Container (`apps/api`) on Cloud Run / ECS Fargate / Fly.io. Secrets: `DATABASE_URL`, `CORS_ORIGIN`. Release step: `prisma migrate deploy` |
| Web       | `vite build` → CloudFront / Netlify / Vercel, `VITE_API_URL` set, or same-origin behind the API's reverse proxy at `/api` |
| CI        | typecheck (`tsc --noEmit` both apps) → `prisma migrate diff` check → build image → deploy |

A `Dockerfile` per app and a `fly.toml` / Terraform module are the immediate
infra to-dos.

## 6. Roadmap (post-MVP)

1. **Auth & multi-tenancy** — `Organization`, `User`, `Membership(role)`; every
   top-level table gets `orgId`; JWT/session middleware; row scoping. Roles:
   admin / estimator / viewer.
2. **Versioning & baselines** — immutable project snapshots ("Tender", "IFC",
   "Rev C"); diff two baselines; lock a baseline from edits. This is the core PLM
   value and the reason for cost snapshotting on BOM lines.
3. **Revisions on nodes & materials** — track change history, effectivity dates,
   and who changed a price.
4. **3D DMU viewer** — load IFC (via `web-ifc` / IFC.js) or glTF; map model
   elements ↔ `Node` (`Node.attributes.ifcGuid`); select in 3D → BOM in panel.
   The tree model already is the DMU; the viewer is an overlay.
5. **Quantity take-off aids** — formula fields on BOM lines referencing node
   attributes (area, length, count) instead of hard numbers.
6. **Procurement** — group BOM lines into packages, RFQs, purchase orders;
   committed vs. estimated cost tracking.
7. **Rate libraries & regional pricing** — versioned catalogs, price books per
   region/date, escalation.
8. **Import/export** — Excel/CSV BOM round-trip, IFC import, API for BIM tools.
9. **Reporting** — cost plan by CBS/WBS, S-curves, variance vs. baseline.
10. **Audit log & optimistic concurrency** — `updatedAt` version checks on writes,
    full change feed.

## 7. Known MVP simplifications

- No auth — every caller has full access.
- Materials are global, not org- or project-scoped.
- `Node.type` is advisory; no rule stops a `COMPONENT` having children or a
  `GROUP` carrying BOM lines.
- Roll-up computed on every read (no caching / materialisation).
- No pagination on list endpoints.
- No soft-delete or history — deletes cascade hard.
- Frontend types are hand-mirrored from the Prisma schema.
