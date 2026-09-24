import type Anthropic from "@anthropic-ai/sdk";
import { READONLY_TOOLS, ALL_TOOLS } from "./tools.js";
import { actionKey } from "./helpers.js";
import { MODEL, client, agentEnabled, notConfiguredMessage, reasoningParams } from "./provider.js";

const MAX_ITERS = 12;

export { agentEnabled };

const LANG_NAME: Record<string, string> = { en: "English", hi: "Hindi (हिन्दी)", ta: "Tamil (தமிழ்)" };

function systemPrompt(language: string, operate: boolean) {
  const lang = LANG_NAME[language] ?? "English";
  const capability = operate
    ? `You can both **read** the project data and **make changes** to it (create/update/delete). The user has turned on "allow changes" for this session.`
    : `You are strictly **read-only** — you cannot create, edit, delete, send emails, or change anything. If the user asks you to perform such an action, explain that you can only read and report, and tell them where in the app to do it themselves (or that they can turn on "allow changes" for the assistant).`;

  const actionRules = operate
    ? `

Performing actions — most of this is Claude-Code-style: act on clear intent, then report what you did. Don't interrogate the user for permission on routine, reversible changes.
- **Creating, updating, moving something, assigning a supplier, or inviting suppliers onto an RFQ** (invite_rfq_suppliers): just call the tool and do it. No preview step, no "shall I go ahead?" — the user already told you what they want. Afterward, say in one short sentence what changed. If they immediately ask for another change, do that one too, the same way — don't re-ask for things you already have clear instructions for.
- **Deleting something** (delete_project, delete_node, delete_category, delete_bom_line, delete_material, delete_supplier, delete_rfq) **or sending real email** (send_rfq_emails, send_email) are the exceptions, because both are irreversible — no undo, no trash, no version history, and an email can't be unsent:
  1. Call the tool WITHOUT \`confirm\` first. It changes nothing — it returns a preview of exactly what would happen (cascade counts for a delete; the recipient list, and whether SMTP is even configured, for an email).
  2. Relay that preview and ask the user to confirm. Never call the same tool with confirm:true in the same reply where you first describe it.
  3. Only call it again with \`confirm: true\` after the user's NEXT message clearly agrees (any language/phrasing — "yes", "haan", "seri", "go ahead" all count). If they say no or change the subject, drop it.
  4. If a call errors saying it wasn't previewed yet, you tried to confirm too early — call it again without confirm and wait for their reply.
- **Check stock before assuming something must be bought.** If the user asks to raise an RFQ or asks what to order, call \`get_project_coverage\` first and quote the shortfall, not the full BOM quantity — buying what's already in the warehouse is the mistake this data exists to prevent.
- Stock movements (\`record_stock_movement\`, \`transfer_stock\`, \`reserve_stock\`) are ordinary bookkeeping and run immediately. A wrong entry is fixed with another ADJUSTMENT, never by deleting — the ledger is append-only.
- To actually send an RFQ: invite suppliers first (invite_rfq_suppliers, no confirmation needed), then send_rfq_emails (does need confirmation, since it emails real people).
- **Free-form email** (send_email): when asked to email a supplier or anyone else about something other than an RFQ invitation, write the whole email yourself (greeting, clear body, sign-off as "Procurement, Summer" — never invent a person's name), pull any facts from the data first (PO numbers, quantities, dates), and give recipients as supplier names or exact addresses. It needs the same preview → confirm step as send_rfq_emails, so show the user the subject and body in the preview. Never make up an email address — if the user names a person without an address, ask for it.
- Never guess an id. Look one up first with search_nodes / get_node / list_materials / list_suppliers / list_rfqs, and if more than one thing matches, ask which.
- **One RFQ per request, not one per node.** If the user wants a single RFQ for something repeated across many nodes (e.g. "raise an RFQ for the windows" when there are 24 window lines across 24 apartments), do NOT call create_rfq once per node. Instead use search_bom_lines to gather the matching lines across the project (or a subtree), then make ONE create_rfq call with an explicit \`items\` array — either one aggregated line (summed quantity) if they just want a total, or one item per bomLineId for per-unit traceability. Use add_rfq_items to bundle in more lines later if the RFQ already exists.
- If the user is clearly making several changes in a row, keep going turn after turn without re-explaining the whole plan each time — treat it like a normal back-and-forth, not a fresh approval each step.`
    : "";

  return `You are the assistant inside **Summer**, a construction PLM / BOM web application. You help the user understand their projects by reading data through tools. ${capability}

Domain model:
- A **Project** has a **DMU tree** of Nodes (GROUP → SUBGROUP → ASSEMBLY → COMPONENT). Each node has a **quantity** meaning "how many of this subtree the parent contains" (so a "Typical Floor ×8" or an apartment "×10" is instanced, not duplicated).
- Every node can carry **BOM lines**. A line has a **kind**: MATERIAL (catalog rate + wastage + install labour) or the flat non-material kinds LABOUR / EQUIPMENT / TRANSPORT / OVERHEAD.
- Cost roll-up: line total → node directCost → rolledCost = quantity × (directCost + Σ child rolledCost). The project total is the sum of the top-level nodes.
- **Inventory**: **Warehouses** hold physical stock of catalog materials. Each stock line has an on-hand quantity, a part of it possibly **reserved** for a specific project, and a reorder (minimum) level. Every change is written to an append-only **ledger** (received / issued / corrected / transferred). The point of it: \`get_project_coverage\` nets a project's BOM demand against what's already in the warehouses, so "what do we still have to buy" is the shortfall, not the full BOM.
- **Materials** are a global catalog. **Suppliers** have contacts and trades. A BOM line can have an assigned **supplier** (per project/tower/node). **RFQs** are sent to suppliers, who quote back through a portal; the app compares quotes and records an award. An RFQ's line items are NOT limited to one node — one RFQ can bundle lines gathered from many different nodes (see the RFQ rule below).

How to work:
- Use tools to get real numbers — never guess costs or counts. Prefer \`get_cost_summary\` for "what does it cost / where's the money", \`search_nodes\` then \`get_node\` for specifics, \`get_supplier_assignments\` for "who supplies X and where", \`check_stock\` for "do we have any X / where is it", and \`get_project_coverage\` for "what do we still need to buy".
- Money values come pre-formatted in \`*_display\` fields — use those.
- When you reference a node, give its path (e.g. "Tower 2 › Superstructure › …").
- If a project/node isn't found, say so plainly.${actionRules}

Answer style — this is a spoken assistant, so be sharp:
- Lead with the answer — the number, the name, the yes/no — in the first sentence.
- 1–3 sentences for most questions. A short bullet list only when the user asks for several things or a breakdown.
- No preamble, no "Let me check…", no restating the question, no summary of what you did. Just the answer.
- Only add a caveat or extra detail if it changes the decision.
- Tables only when the user explicitly asks to compare. Never dump raw JSON.
- Answer only what was asked. Do NOT volunteer unit rates, cost breakdowns, wastage, labour splits or pricing detail unless the user's question is about cost, rate or price. If they ask "which supplier" or "how many", give just that.

Respond in **${lang}**, in plain everyday spoken language — the way a colleague would say it out loud, not a formal report. Keep numerals and currency readable; you may keep material/technical terms and codes (RFQ-0001, THU-001, M30) in Latin script.`;
}

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; name: string; ok: boolean }
  | { type: "done"; appended: Anthropic.MessageParam[] }
  | { type: "error"; message: string };

/** Has this exact mutating action already been shown to the user (as a `pending`
 *  preview) in an earlier turn of this conversation? Used to refuse a
 *  `confirm:true` call that wasn't preceded by a real round-trip to the user —
 *  so a model can never propose-and-execute an action in one breath. */
function wasProposed(history: Anthropic.MessageParam[], key: string): boolean {
  const needle1 = `"key":"${key}"`;
  const needle2 = '"pending":true';
  for (const m of history) {
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (!b || typeof b !== "object" || (b as { type?: string }).type !== "tool_result") continue;
      const c = (b as { content?: unknown }).content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (x as { text?: string })?.text ?? "").join("") : "";
      if (text.includes(needle1) && text.includes(needle2)) return true;
    }
  }
  return false;
}

/** Heal a history where an assistant turn has tool_use blocks with no matching
 *  tool_result right after it (an older run that was cut off, or a stored
 *  conversation from before that was fixed). Missing results are filled in with an
 *  "interrupted" error so the model can carry on instead of every request 400ing. */
function repairHistory(history: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (let i = 0; i < history.length; i++) {
    const m = history[i]!;
    out.push(m);
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    const ids = (m.content as Array<{ type?: string; id?: string }>)
      .filter((b) => b?.type === "tool_use" && b.id)
      .map((b) => b.id!);
    if (!ids.length) continue;

    const next = history[i + 1];
    const nextBlocks: Anthropic.ContentBlockParam[] =
      next?.role === "user" && Array.isArray(next.content) ? (next.content as Anthropic.ContentBlockParam[]) : [];
    const have = new Set(
      nextBlocks.filter((b) => b.type === "tool_result").map((b) => (b as Anthropic.ToolResultBlockParam).tool_use_id),
    );
    const missing = ids.filter((id) => !have.has(id));
    if (!missing.length) continue;

    const fill: Anthropic.ToolResultBlockParam[] = missing.map((id) => ({
      type: "tool_result",
      tool_use_id: id,
      content: "error: this call was interrupted before it ran — no result available.",
      is_error: true,
    }));
    if (next?.role === "user" && Array.isArray(next.content)) {
      // tool_results must lead the user message
      out.push({ role: "user", content: [...fill, ...nextBlocks] });
      i++;
    } else {
      out.push({ role: "user", content: fill });
    }
  }
  return out;
}

export async function runAgent(opts: {
  messages: Anthropic.MessageParam[];
  language: string;
  operate?: boolean;
  onEvent: (e: AgentEvent) => void;
  signal?: AbortSignal;
}) {
  if (!client) {
    opts.onEvent({ type: "error", message: notConfiguredMessage });
    return;
  }

  const operate = Boolean(opts.operate);
  const tools = operate ? ALL_TOOLS : READONLY_TOOLS;
  const toolDefs = tools.map((t) => t.def);
  const byName = new Map(tools.map((t) => [t.def.name, t]));
  // Snapshot of the history the client sent, BEFORE this run appends anything —
  // this is what wasProposed() checks against, so a proposal only counts once
  // the user has actually seen it and replied (i.e. it came from a past request).
  const priorHistory = repairHistory(opts.messages);
  let messages = [...priorHistory];
  const appended: Anthropic.MessageParam[] = [];

  try {
    for (let iter = 0; iter < MAX_ITERS; iter++) {
      const stream = client.messages.stream(
        {
          model: MODEL,
          max_tokens: 8000,
          system: systemPrompt(opts.language, operate),
          ...reasoningParams,
          tools: toolDefs,
          messages,
        },
        { signal: opts.signal },
      );

      stream.on("text", (delta) => opts.onEvent({ type: "text", delta }));
      const msg = await stream.finalMessage();

      messages.push({ role: "assistant", content: msg.content });
      appended.push({ role: "assistant", content: msg.content });

      // Key off the blocks, not stop_reason: a reply cut off by max_tokens (e.g. a huge
      // batch of parallel calls) still carries tool_use blocks, and every one needs a
      // tool_result or the API rejects the whole conversation from then on.
      const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) break;
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        opts.onEvent({ type: "tool_start", id: tu.id, name: tu.name, input: tu.input });
        const tool = byName.get(tu.name);
        try {
          const input = (tu.input ?? {}) as Record<string, unknown>;
          let out: unknown;
          if (!tool) {
            out = { error: `unknown tool ${tu.name}` };
          } else if (tool.mutating && tool.destructive) {
            // Irreversible (a delete) — the only class of action that goes through
            // propose-then-confirm. Everything else just happens (see below).
            const key = actionKey(tu.name, input);
            if (input.confirm === true && !wasProposed(priorHistory, key)) {
              out = {
                error:
                  "This exact action hasn't been previewed yet in an earlier message (or its parameters changed). Call this tool again WITHOUT confirm to show the user what would happen, then wait for their next reply before confirming.",
              };
            } else {
              out = await tool.run({ ...input, __confirmKey: key });
            }
          } else if (tool.mutating) {
            // Reversible (create/update/move/assign/award) — runs immediately,
            // same way Claude Code applies an edit without asking every time.
            out = await tool.run({ ...input, confirm: true });
          } else {
            out = await tool.run(input);
          }
          results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 60_000) });
          opts.onEvent({ type: "tool_end", id: tu.id, name: tu.name, ok: true });
        } catch (err) {
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: `error: ${(err as Error).message}`,
            is_error: true,
          });
          opts.onEvent({ type: "tool_end", id: tu.id, name: tu.name, ok: false });
        }
      }
      const userMsg: Anthropic.MessageParam = { role: "user", content: results };
      messages.push(userMsg);
      appended.push(userMsg);
    }
    opts.onEvent({ type: "done", appended });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    opts.onEvent({ type: "error", message: (err as Error).message });
  }
}
