// The tool-calling loop for the Ask chat: the model reads the ledger through engine.ts's tools
// and does its arithmetic there, round after round, until it answers in words. One loop per
// provider (Mistral's function calling, Anthropic's tool use); both take the fetch/client to use
// so tests can stand in a fake model (tests/ledger-ai-agent.test.mjs).

export type Turn = { role: "user" | "assistant"; content: string };
export type Tool = { name: string; description: string; parameters: Record<string, unknown> };
export type Run = (name: string, args: Record<string, unknown>) => { result: unknown; label: string };
export type Outcome = { text: string; model: string; cut: boolean; steps: string[]; rounds: number };

const MAX_ROUNDS = 8;          // tool rounds before the model must answer with what it has
const RESULT_CHARS = 14000;    // one tool result's size cap: a 200-row listing fits, a dump does not

// One tool call, never thrown: a bad filter or expression goes back to the model as an error it
// can correct, and the owner sees what was tried.
function callTool(run: Run, name: string, rawArgs: unknown, steps: string[]) {
  let args: Record<string, unknown> = {};
  if (rawArgs && typeof rawArgs === "object") args = rawArgs as Record<string, unknown>;
  else if (typeof rawArgs === "string" && rawArgs.trim()) { try { args = JSON.parse(rawArgs); } catch { args = {}; } }
  try {
    const out = run(name, args);
    steps.push(out.label);
    return clip(JSON.stringify(out.result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    steps.push(`${name} failed: ${msg}`);
    return JSON.stringify({ error: msg });
  }
}
function clip(s: string) { return s.length > RESULT_CHARS ? s.slice(0, RESULT_CHARS) + `\n...(cut at ${RESULT_CHARS} characters: narrow the filter or lower the limit)` : s; }

export async function mistralAgent(o: { fetchImpl: typeof fetch; key: string; model: string; system: string; messages: Turn[]; tools: Tool[]; run: Run }): Promise<Outcome> {
  const msgs: Record<string, unknown>[] = [{ role: "system", content: o.system }, ...o.messages];
  const tools = o.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const steps: string[] = [];
  for (let round = 1; ; round++) {
    const last = round > MAX_ROUNDS;
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
        msgs.push({ role: "tool", name, content: callTool(o.run, name, tc.function?.arguments, steps), tool_call_id: tc.id });
      }
      continue;
    }
    return { text: String(m.content ?? ""), model: o.model, cut: choice?.finish_reason === "length", steps, rounds: round };
  }
}

// Anthropic's shape: tool_use blocks in the reply, tool_result blocks in the next user turn.
export async function claudeAgent(o: { create: (params: Record<string, unknown>) => Promise<any>; model: string; system: string; messages: Turn[]; tools: Tool[]; run: Run }): Promise<Outcome> {
  const msgs: Record<string, unknown>[] = [...o.messages];
  const tools = o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const steps: string[] = [];
  for (let round = 1; ; round++) {
    const last = round > MAX_ROUNDS;
    const res = await o.create({ model: o.model, max_tokens: 4000, system: o.system, messages: msgs, ...(last ? {} : { tools }) });
    if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
    const blocks: any[] = Array.isArray(res.content) ? res.content : [];
    const uses = blocks.filter((b) => b.type === "tool_use");
    if (uses.length && !last) {
      msgs.push({ role: "assistant", content: blocks });
      msgs.push({ role: "user", content: uses.map((u) => ({ type: "tool_result", tool_use_id: u.id, content: callTool(o.run, u.name, u.input, steps) })) });
      continue;
    }
    return { text: blocks.map((b) => (b.type === "text" ? b.text : "")).join(""), model: res.model || o.model, cut: res.stop_reason === "max_tokens", steps, rounds: round };
  }
}
