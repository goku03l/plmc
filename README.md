# PLMC — PLM / BOM for Construction

Manage a construction project as a **DMU-style product structure** (a configurable
tree of groups → sub-groups → assemblies → components) with a **Bill of Materials
attached to every node**, material costs, labour, wastage, and automatic cost
roll-up to the project total.

```
Project
 ├─ Category[]  ← configurable sub-groups: Interiors, Exteriors, MEP, Structure, Sitework, …
 └─ Node[]      ← self-referencing DMU tree
       └─ BomLine[]  ← BOM attached to the node (qty × unit cost × wastage + labour)
             └─ Material?  ← optional link to the reusable catalog
```

## Tech stack

| Layer     | Choice                                             |
| --------- | -------------------------------------------------- |
| Database  | PostgreSQL 18                                      |
| ORM       | Prisma 6                                           |
| API       | Node 20+ / Fastify 5 / Zod (TypeScript, ESM)       |
| Frontend  | React 18 + Vite 6 + TanStack Query + React Router  |
| Local dev | Docker Compose (Postgres), npm workspaces monorepo |

## Layout

```
plmc/
├─ docker-compose.yml        Postgres on host port 5433
├─ apps/
│  ├─ api/                   Fastify + Prisma service
│  │  ├─ prisma/schema.prisma
│  │  ├─ prisma/seed.ts      demo project "Riverside Office Tower"
│  │  └─ src/
│  │     ├─ app.ts  index.ts  cost.ts  schemas.ts
│  │     └─ routes/  projects · categories · nodes · materials · bom
│  └─ web/                   React SPA
│     └─ src/  pages/  components/  hooks.ts  api.ts
└─ DESIGN.md                 architecture & data-model rationale
```

## Quick start

Prerequisites: **Node 20+** and **PostgreSQL** — either a local server on :5432 or
Docker Desktop (the Docker path needs a WSL2 backend on Windows).

```bash
# 1. install workspaces
npm install

# 2. env file for the API
cp .env.example apps/api/.env         # Windows: copy .env.example apps\api\.env
#    then edit apps/api/.env -> set DATABASE_URL (password / host)

# 3a. using a local Postgres:
psql -U postgres -c "CREATE DATABASE plmc;"
npm run db:migrate
npm run db:seed

# 3b. or using Docker (WSL2 required):
npm run setup                          # db:up + migrate + seed

# 4. run API (:4000) and web (:5173) together
npm run dev
```

Open http://localhost:5173.

## Useful scripts

| Command              | Effect                                        |
| -------------------- | --------------------------------------------- |
| `npm run dev`        | API + web with hot reload                     |
| `npm run db:up`      | start the Docker Postgres                     |
| `npm run db:migrate` | apply Prisma migrations                       |
| `npm run db:seed`    | (re)create the demo project + material catalog |
| `npm run db:studio`  | Prisma Studio DB browser                      |
| `npm run db:reset`   | wipe the Docker volume and recreate           |

## API surface (`/api`)

```
GET    /health
GET    /projects                       POST /projects
GET    /projects/:id                   PATCH /projects/:id      DELETE /projects/:id
GET    /projects/:id/tree              full DMU tree + cost roll-up
GET    /projects/:id/summary           totals + cost by sub-group
GET    /projects/:id/categories        POST /projects/:id/categories
PATCH  /categories/:id                 DELETE /categories/:id
POST   /projects/:id/nodes             GET /nodes/:id
PATCH  /nodes/:id    POST /nodes/:id/move    DELETE /nodes/:id
GET    /materials    POST /materials    PATCH /materials/:id    DELETE /materials/:id
GET    /nodes/:id/bom     POST /nodes/:id/bom
PATCH  /bom/:lineId       DELETE /bom/:lineId
```

BOM lines carry a `kind` — `MATERIAL` (catalog rate + wastage + install labour) or the
non-material `LABOR` / `EQUIPMENT` / `TRANSPORT` / `OVERHEAD` (flat qty × rate). The cost
roll-up reports each kind in its own bucket (`/summary` → `byKind`).

### Procurement

```
GET/POST/PATCH/DELETE  /suppliers  /suppliers/:id        contacts + trades
GET/POST/DELETE        /materials/:id/suppliers          link vendors to catalog items
GET  /rfqs   POST /rfqs   GET/PATCH/DELETE /rfqs/:id      RFQ (optionally seeded from a node's BOM)
POST /rfqs/:id/items  ·  /rfqs/:id/suppliers  ·  /rfqs/:id/send  ·  /rfqs/:id/award
GET  /rfqs/:id/attachments/:aid                          download a supplier's file
```

Each BOM line carries an optional `supplierId` — the vendor selected to furnish
*that* line, so the same catalog material can have a different supplier per tower.

```
GET  /projects/:id/supplier-assignments                  material → supplier → where (node paths, extended qty)
POST /projects/:id/assign-supplier {materialId,supplierId,nodeId?}   bulk set, optionally scoped to a subtree
```

### Documents (PDM)

Any file can be attached to a node — drawings, photos, PDFs, spec sheets — with
no type or extension restriction. Shown in the node detail panel ("Documents").

```
GET/POST     /nodes/:nodeId/attachments               list · upload (multipart, field name "file")
GET/DELETE   /nodes/:nodeId/attachments/:attachmentId  download (original filename/type) · delete
```

Files are stored under `apps/api/uploads/nodes/` (git-ignored). Per-file size is
capped by `UPLOAD_MAX_MB` (default 500) — a disk-use bound, not a type filter;
there is no auth on this app, so an unbounded upload endpoint would be a DoS risk.

### Assistant (`/assistant`)

An AI chat (Claude Sonnet, tool-use) over the project data — cost summaries, the
DMU tree, node BOMs, suppliers, supplier assignments, RFQs and quote comparisons.
Answers in **English, हिन्दी or தமிழ்**, in short, spoken-style sentences.

**Read-only by default.** A **🔒 Read-only / ✏️ Changes allowed** toggle switches
it into a mode where it can also create/update/delete projects, nodes, BOM
lines, categories, materials, suppliers, RFQs, supplier assignments, and invite
suppliers to / actually email them an RFQ (`apps/api/src/agent/mutations.ts`).

Most actions just happen — create, update, move, assign a supplier, invite a
supplier onto an RFQ — the same way Claude Code applies an edit without asking
permission each time. Only the **irreversible** ones are two-phase: every
`delete_*` tool, and `send_rfq_emails` (a real email that can't be unsent):

1. Called without `confirm` it validates everything and returns a plain-language
   preview — cascade counts for a delete, the recipient list for an email —
   **without touching the database or sending anything**.
2. The model relays that preview to the user and asks them to confirm.
3. Only once the user's *next* message agrees does the model call the same tool
   again with `confirm: true`. The server independently refuses a `confirm:true`
   call unless a matching `pending` preview already exists earlier in the
   conversation (`wasProposed()` in `chat.ts`) — so the model can never propose
   and execute an action in the same turn, regardless of what it decides to do.
   Which tools get this treatment is the `destructive` flag on `AgentTool`.

This guards against the *agent* jumping ahead on its own; like the rest of this
MVP (see `DESIGN.md` § Known simplifications) there is no auth, so it is not a
defense against a malicious API caller — the REST endpoints have never had one.

Voice:

- **Speech-to-text**: the browser's recognizer drives turn-timing, but the
  captured audio is re-transcribed by **Google Cloud Speech-to-Text** with all
  three languages active at once (so code-mixed "Tanglish"/"Hinglish" works).
  Falls back to the browser's single-language transcript if unset.
- **Text-to-speech**: **Google Cloud Text-to-Speech** (Chirp 3: HD — natural,
  expressive voices), streamed sentence-by-sentence as the reply is generated.
  Falls back to the browser's built-in voice if unset (flat, often silent for
  Hindi/Tamil).
- **Conversation mode** (toggle, off by default): the mic stays open, each reply
  is spoken, and it listens again once the reply finishes — no Send. The mic is
  ignored while it's talking, so it can't hear and interrupt itself.
- A microphone picker appears once more than one input device is available.

```
GET  /agent/status   { enabled, model, tts, stt, languages }
POST /agent/chat     SSE stream: {language, messages[], operate?} → text / tool_start / tool_end / done
POST /agent/tts      {language, text} → { audio (base64 mp3), mime }
POST /agent/stt      {language, mime, audio (base64)} → { transcript, language }
```

Needs `ANTHROPIC_API_KEY` in `apps/api/.env` (see `.env.example`).
`GOOGLE_TTS_API_KEY` (voice + mic) and `AGENT_MODEL` are optional.

Supplier portal (tokenised magic-link, no login):

```
GET  /portal/:token            RFQ + this supplier's draft (no internal budget shown)
POST /portal/:token            save/submit line prices, lead time, notes
POST /portal/:token/files      upload a quote document (stored under apps/api/uploads/)
```

RFQ emails use SMTP when `SMTP_HOST` is set, otherwise the API logs the message to its
console and the portal links still work. See `.env.example`.

## Cost model

Per BOM line:

```
materialCost = quantity × unitCost × (1 + wastagePct/100)
labourCost   = quantity × labourCostPerUnit
lineTotal    = materialCost + labourCost
```

Per node:

```
directCost   = Σ lineTotal                        (own BOM only)
rolledCost   = nodeQuantity × (directCost + Σ child.rolledCost)
```

Project total = Σ rolledCost of the top-level nodes. The cost breakdown attributes
each node's extended direct cost to its nearest sub-group (self or ancestor).

## Cloud deployment (outline)

- **DB**: managed Postgres (RDS / Cloud SQL / Neon / Supabase).
- **API**: container image (`apps/api`) on ECS Fargate / Cloud Run / Fly.io;
  `DATABASE_URL` + `CORS_ORIGIN` as secrets; run `prisma migrate deploy` on release.
- **Web**: `npm run build --workspace @plmc/web` → static host (CloudFront / Netlify)
  with `VITE_API_URL` pointing at the API, or serve behind the same domain at `/api`.

See `DESIGN.md` for the full architecture, the roadmap (auth/multi-tenancy,
versioning & baselines, IFC/glTF 3D viewer, revisions, procurement), and the
rationale behind each modelling decision.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01USdzH6PPnPUSsxWsXctLTD
