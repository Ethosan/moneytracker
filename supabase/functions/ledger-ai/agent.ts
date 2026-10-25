// The tool-calling loop for the Ask chat: the model reads the ledger through engine.ts's tools
// and does its arithmetic there, round after round, until it answers in words. One loop per
// provider (Mistral's function calling, Anthropic's tool use); both take the fetch/client to use
// so tests can stand in a fake model (tests/ledger-ai-agent.test.mjs).
//
// Every answer is audited before it goes out: each figure in it is matched against the numbers
// the model was given (the snapshot, the totals, every tool result). A figure that came from
// nowhere, which means the model worked it out in its head, sends the answer back once with the
// list of those figures, so they are recomputed with calculate or dropped. What the audit found
// is reported in the steps the owner sees.

export type Turn = { role: "user" | "assistant"; content: string };
export type Tool = { name: string; description: string; parameters: Record<string, unknown> };
export type Run = (name: string, args: Record<string, unknown>) => { result: unknown; label: string };
export type Outcome = { text: string; model: string; cut: boolean; steps: string[]; rounds: number; unverified: number[] };

const MAX_ROUNDS = 8;          // tool rounds before the model must answer with what it has
const RESULT_CHARS = 14000;    // one tool result's size cap: a 200-row listing fits, a dump does not

// One tool call, never thrown: a bad filter or expression goes back to the model as an error it
// can correct, and the owner sees what was tried.
function callTool(run: Run, name: string, rawArgs: unknown, steps: string[], known: Set<number>) {
  let args: Record<string, unknown> = {};
  if (rawArgs && typeof rawArgs === "object") args = rawArgs as Record<string, unknown>;
  else if (typeof rawArgs === "string" && rawArgs.trim()) { try { args = JSON.parse(rawArgs); } catch { args = {}; } }
  try {
    const out = run(name, args);
    steps.push(out.label);
    const text = clip(JSON.stringify(out.result));
    for (const n of numbersIn(text)) known.add(n);
    return text;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    steps.push(`${name} failed: ${msg}`);
    return JSON.stringify({ error: msg });
  }
}
function clip(s: string) { return s.length > RESULT_CHARS ? s.slice(0, RESULT_CHARS) + `\n...(cut at ${RESULT_CHARS} characters: narrow the filter or lower the limit)` : s; }

// The figures in a text, as absolute values: dates, times, years, small counts (0-31) and digits
// glued to letters (ids, "5x") are not figures. Commas inside numbers are thousands separators.
export function numbersIn(text: string): number[] {
  const s = String(text || "").replace(/\d{4}-\d{2}(-\d{2})?/g, " ").replace(/\b\d{1,2}:\d{2}\b/g, " ");
  const out: number[] = [];
  const re = /(?<![A-Za-z0-9_.])(\d[\d,]*(?:\.\d+)?)(?![A-Za-z0-9_])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const v = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(v)) continue;
    if (Number.isInteger(v) && (v <= 31 || (v >= 1900 && v <= 2100))) continue;
    out.push(v);
  }
  return out;
}
const decimals = (v: number) => { const s = String(v); const i = s.indexOf("."); return i < 0 ? 0 : s.length - i - 1; };
// A figure is known when some given number equals it, or rounds to it at the decimals it was
// written with ($2,827 for 2827.41 is fine; $2,830 is not).
export function unknownNumbers(text: string, known: Set<number>): number[] {
  const list = [...known];
  const out: number[] = [];
  for (const v of new Set(numbersIn(text))) {
    const d = Math.min(decimals(v), 6), f = Math.pow(10, d);
    const ok = list.some((k) => Math.abs(k - v) < 0.005 || Math.abs(Math.round(k * f) / f - v) < 0.5 / f + 1e-9);
    if (!ok) out.push(v);
  }
  return out;
}
const auditMessage = (bad: number[]) =>
  `Check before this goes out: these figures in your answer are not in any lookup or calculation result, so they were worked out by hand: ${bad.join(", ")}. ` +
  `Work each one out with calculate (differences, averages, percentages included) or leave it out, then give the complete answer again with the corrected figures. Do not mention this check.`;

type Audit = { known: Set<number>; repaired: boolean };
function startAudit(messages: Turn[]): Audit {
  const known = new Set<number>();
  for (const m of messages) for (const n of numbersIn(m.content)) known.add(n);
  return { known, repaired: false };
}
// Decides whether an answer goes out or back: returns the audit message to send, or null, and
// notes the outcome in the steps.
function finish(a: Audit, text: string, steps: string[], canRepair: boolean): { ask: string | null; unverified: number[] } {
  const bad = unknownNumbers(text, a.known);
  if (!bad.length) { steps.push(a.repaired ? "Rechecked every figure against the lookups" : "Checked every figure against the lookups"); return { ask: null, unverified: [] }; }
  if (canRepair && !a.repaired) { a.repaired = true; steps.push(`Caught ${bad.length} figure${bad.length === 1 ? "" : "s"} worked out by hand (${bad.slice(0, 6).join(", ")}), recomputing`); return { ask: auditMessage(bad), unverified: bad }; }
  steps.push(`Could not verify: ${bad.slice(0, 6).join(", ")}${bad.length > 6 ? ", ..." : ""}`);
  return { ask: null, unverified: bad };
}

export async function mistralAgent(o: { fetchImpl: typeof fetch; key: string; model: string; system: string; messages: Turn[]; tools: Tool[]; run: Run }): Promise<Outcome> {
  const msgs: Record<string, unknown>[] = [{ role: "system", content: o.system }, ...o.messages];
  const tools = o.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const steps: string[] = [], audit = startAudit(o.messages);
  for (let round = 1; ; round++) {
    const last = round > MAX_ROUNDS + (audit.repaired ? 2 : 0);
    const r = await o.fetchImpl("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${o.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: o.model, messages: msgs, temperature: 0.1, max_tokens: 2500, tools, tool_choice: last ? "none" : "auto" }),
    });
    if (!r.ok) throw new Error(`Mistral ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const data = await r.json();
    const choice = data.choices?.[0], m = choice?.message || {};
    const calls: any[] = Array.isArray(m.tool_calls) ? m.tool_calls : [];
    if (calls.length && !last) {
      msgs.push({ role: "assistant", content: m.content || "", tool_calls: calls });
      for (const tc of calls) {
        const name = tc.function?.name || "";
        msgs.push({ role: "tool", name, content: callTool(o.run, name, tc.function?.arguments, steps, audit.known), tool_call_id: tc.id });
      }
      continue;
    }
    const text = String(m.content ?? ""), cut = choice?.finish_reason === "length";
    const f = finish(audit, text, steps, !last && !cut);
    if (f.ask) { msgs.push({ role: "assistant", content: text }, { role: "user", content: f.ask }); continue; }
    return { text, model: o.model, cut, steps, rounds: round, unverified: f.unverified };
  }
}

// Anthropic's shape: tool_use blocks in the reply, tool_result blocks in the next user turn.
export async function claudeAgent(o: { create: (params: Record<string, unknown>) => Promise<any>; model: string; system: string; messages: Turn[]; tools: Tool[]; run: Run }): Promise<Outcome> {
  const msgs: Record<string, unknown>[] = [...o.messages];
  const tools = o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const steps: string[] = [], audit = startAudit(o.messages);
  for (let round = 1; ; round++) {
    const last = round > MAX_ROUNDS + (audit.repaired ? 2 : 0);
    const res = await o.create({ model: o.model, max_tokens: 4000, system: o.system, messages: msgs, ...(last ? {} : { tools }) });
    if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
    const blocks: any[] = Array.isArray(res.content) ? res.content : [];
    const uses = blocks.filter((b) => b.type === "tool_use");
    if (uses.length && !last) {
      msgs.push({ role: "assistant", content: blocks });
      msgs.push({ role: "user", content: uses.map((u) => ({ type: "tool_result", tool_use_id: u.id, content: callTool(o.run, u.name, u.input, steps, audit.known) })) });
      continue;
    }
    const text = blocks.map((b) => (b.type === "text" ? b.text : "")).join(""), cut = res.stop_reason === "max_tokens";
    const f = finish(audit, text, steps, !last && !cut);
    if (f.ask) { msgs.push({ role: "assistant", content: text || "(empty)" }, { role: "user", content: f.ask }); continue; }
    return { text, model: res.model || o.model, cut, steps, rounds: round, unverified: f.unverified };
  }
}
