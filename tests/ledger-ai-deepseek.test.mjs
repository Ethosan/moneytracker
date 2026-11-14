// DeepSeek in the Ask chat and the review (supabase/functions/ledger-ai/agent.ts, providers.ts)
// against a fake DeepSeek: the request it is sent (URL, model, OpenAI-style tools, thinking off),
// the tool-call loop with the real engine doing the sums, which model each job gets, and who
// answers when a provider fails.
import test from "node:test";
import assert from "node:assert/strict";
import { deepseekAgent, mistralAgent } from "../supabase/functions/ledger-ai/agent.ts";
import { loadLedger, runTool, TOOLS } from "../supabase/functions/ledger-ai/engine.ts";
import { provider, fallbacks, firstThatAnswers, deepseekModel, deepseekBase, deepseekExtra, modelRefused, DEEPSEEK_DEFAULT } from "../supabase/functions/ledger-ai/providers.ts";

const tools = [{ name: "calculate", description: "x", parameters: { type: "object" } }, { name: "search_transactions", description: "x", parameters: { type: "object" } }];
const run = (name, args) => {
  if (name === "calculate") return { result: { result: 42 }, label: `Worked out ${args.expression} = 42` };
  if (name === "search_transactions") return { result: { matched: 3, total_of_matched: 61.5 }, label: `Looked up ${args.note}: 3 rows, 61.5` };
  throw new Error("Unknown tool: " + name);
};
const OFF = { thinking: { type: "disabled" } };

// a scripted DeepSeek: each entry is one reply's message (or a function of the round), in order
function fakeDeepSeek(replies, usage) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const i = seen.length - 1, message = (typeof replies === "function" ? replies(i) : replies[i]) || { content: "(out of script)" };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }], ...(usage ? { usage } : {}) }), text: async () => "" };
  };
  return { fetchImpl, seen };
}
const ds = (f, extra = {}) => ({ fetchImpl: f.fetchImpl, base: "https://api.deepseek.com", extra: OFF, key: "k", model: "deepseek-v4-pro", system: "sys", tools, run, ...extra });

test("DeepSeek request: chat/completions on the base URL, Bearer key, OpenAI tools, thinking off", async () => {
  const f = fakeDeepSeek([{ content: "Nothing to look up." }]);
  await deepseekAgent(ds(f, { base: "https://api.deepseek.com/", messages: [{ role: "user", content: "hi" }] }));
  const r = f.seen[0];
  assert.equal(r.url, "https://api.deepseek.com/chat/completions");
  assert.equal(r.headers.Authorization, "Bearer k");
  assert.equal(r.body.model, "deepseek-v4-pro");
  assert.deepEqual(r.body.thinking, { type: "disabled" });
  assert.equal(r.body.tool_choice, "auto");
  assert.equal(r.body.max_tokens, 6000);
  assert.deepEqual(r.body.tools[0], { type: "function", function: { name: "calculate", description: "x", parameters: { type: "object" } } });
  assert.deepEqual(r.body.messages[0], { role: "system", content: "sys" });
});

test("DeepSeek loop: tool calls go back as OpenAI tool messages (no name field), then the answer", async () => {
  const f = fakeDeepSeek([
    { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "search_transactions", arguments: '{"note":"claude"}' } }] },
    { content: "", tool_calls: [{ id: "c2", type: "function", function: { name: "calculate", arguments: '{"expression":"61.5/3"}' } }] },
    { content: "You spent **$61.50** on Claude." },
  ]);
  const out = await deepseekAgent(ds(f, { messages: [{ role: "user", content: "claude?" }] }));
  assert.equal(out.text, "You spent **$61.50** on Claude.");
  assert.equal(out.model, "deepseek-v4-pro");
  assert.equal(out.rounds, 3);
  assert.deepEqual(out.steps, ["Looked up claude: 3 rows, 61.5", "Worked out 61.5/3 = 42", "Checked every figure against the lookups"]);
  const third = f.seen[2].body.messages;
  assert.deepEqual(third[2], { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "search_transactions", arguments: '{"note":"claude"}' } }] });
  assert.deepEqual(third[3], { role: "tool", tool_call_id: "c1", content: JSON.stringify({ matched: 3, total_of_matched: 61.5 }) });
  assert.deepEqual(third[5], { role: "tool", tool_call_id: "c2", content: JSON.stringify({ result: 42 }) });
  // thinking stays off on every round, not only the first
  for (const r of f.seen) assert.deepEqual(r.body.thinking, { type: "disabled" });
});

test("DeepSeek loop: a reasoning_content that comes back is sent back with its tool calls", async () => {
  const f = fakeDeepSeek([
    { content: "", reasoning_content: "need the total", tool_calls: [{ id: "c1", function: { name: "calculate", arguments: '{"expression":"1+1"}' } }] },
    { content: "Done." },
  ]);
  await deepseekAgent(ds(f, { messages: [] }));
  assert.equal(f.seen[1].body.messages[1].reasoning_content, "need the total");
});

test("DeepSeek loop: the round cap forces an answer with tool_choice none", async () => {
  const f = fakeDeepSeek(() => ({ content: "", tool_calls: [{ id: "x", function: { name: "calculate", arguments: '{"expression":"1+1"}' } }] }));
  const out = await deepseekAgent(ds(f, { messages: [] }));
  assert.equal(out.rounds, 9);
  assert.equal(f.seen[8].body.tool_choice, "none");
  assert.deepEqual(f.seen[8].body.thinking, { type: "disabled" });
  assert.match(out.text, /couldn't finish working this out/);
});

test("DeepSeek loop: an upstream error carries the provider and status; usage is summed over rounds", async () => {
  const bad = async () => ({ ok: false, status: 402, text: async () => "Insufficient Balance", json: async () => ({}) });
  await assert.rejects(deepseekAgent({ ...ds({ fetchImpl: bad }), messages: [] }), /^Error: DeepSeek 402: Insufficient Balance/);
  const f = fakeDeepSeek([
    { content: "", tool_calls: [{ id: "c", function: { name: "calculate", arguments: '{"expression":"1+1"}' } }] },
    { content: "Done." },
  ], { prompt_tokens: 1000, completion_tokens: 50, prompt_cache_hit_tokens: 800 });
  const out = await deepseekAgent(ds(f, { messages: [] }));
  assert.deepEqual(out.usage, { input: 2000, output: 100, cached: 1600 });
});

test("DeepSeek loop: a figure worked out by hand is sent back once and recomputed", async () => {
  const f = fakeDeepSeek([
    { content: "", tool_calls: [{ id: "c1", function: { name: "search_transactions", arguments: '{"note":"x"}' } }] },
    { content: "That is **$61.50**, about **$20.50** a time." },
    { content: "", tool_calls: [{ id: "c2", function: { name: "calculate", arguments: '{"expression":"61.5/3"}' } }] },
    { content: "That is **$61.50**, about **$42** a time." },
  ]);
  const out = await deepseekAgent(ds(f, { messages: [{ role: "user", content: "x?" }] }));
  assert.equal(out.text, "That is **$61.50**, about **$42** a time.");
  assert.match(out.steps.join("\n"), /Caught 1 figure worked out by hand \(20.5\)/);
  assert.match(f.seen[2].body.messages.at(-1).content, /not in any lookup or calculation result/);
  assert.deepEqual(out.unverified, []);
});

// The real engine on sample data: the sums the model quotes are the engine's, not its own.
const doc = {
  meta: { cats: [{ name: "🍜 Food", type: "exp" }, { name: "🚇 Transport", type: "exp" }, { name: "💼 Salary", type: "inc", kind: "earned" }] },
  "tx-2026-09": { items: [
    { id: "a1", d: "2026-09-03", t: "exp", amt: 40, cat: "🍜 Food", note: "Dinner", split: { mine: 20, person: "Sam" } },
    { id: "a2", d: "2026-09-10", t: "inc", amt: 3000, cat: "💼 Salary", note: "Pay" },
    { id: "a3", d: "2026-09-12", t: "exp", amt: 2.5, cat: "🚇 Transport", note: "MRT" },
  ] },
  "tx-2026-10": { items: [
    { id: "b1", d: "2026-10-01", t: "exp", amt: 12.5, cat: "🍜 Food", note: "Lunch" },
    { id: "b2", d: "2026-10-02", t: "exp", amt: 30, cat: "🍜 Food", note: "Groceries" },
    { id: "b3", d: "2026-10-06", t: "inc", amt: 3000, cat: "💼 Salary", note: "Pay" },
  ] },
};
test("DeepSeek loop with the real engine: food over two months is the engine's own-share total", async () => {
  const L = loadLedger(doc);
  const realRun = (name, args) => runTool(L, name, args);
  const f = fakeDeepSeek([
    { content: "", tool_calls: [{ id: "s", function: { name: "search_transactions", arguments: JSON.stringify({ type: "exp", category: "Food", from: "2026-09-01", to: "2026-10-31", group_by: "month", limit: 200 }) } }] },
    { content: "", tool_calls: [{ id: "c", function: { name: "calculate", arguments: '{"expression":"62.5/2"}' } }] },
    { content: "Food came to **$62.50** (Sam paid half the dinner), **$31.25** a month." },
  ]);
  const out = await deepseekAgent(ds(f, { tools: TOOLS, run: realRun, messages: [{ role: "user", content: "food since September?" }] }));
  const search = JSON.parse(f.seen[1].body.messages[3].content);
  // 20 (own half of the 40 dinner) + 12.5 + 30
  assert.equal(search.total_of_matched, 62.5);
  assert.equal(search.matched, 3);
  assert.equal(JSON.parse(f.seen[2].body.messages[5].content).result, 31.25);
  assert.match(out.steps.at(-1), /^Checked every figure/);
  assert.deepEqual(out.unverified, []);
  assert.equal(f.seen[0].body.tools.length, TOOLS.length);
});

test("Mistral keeps its own URL and the tool name on tool messages", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, body: JSON.parse(init.body) }); const message = seen.length === 1 ? { content: "", tool_calls: [{ id: "c", function: { name: "calculate", arguments: "{}" } }] } : { content: "ok" }; return { ok: true, json: async () => ({ choices: [{ message }] }) }; };
  await mistralAgent({ fetchImpl, key: "k", model: "mistral-large-latest", system: "s", messages: [], tools, run });
  assert.equal(seen[0].url, "https://api.mistral.ai/v1/chat/completions");
  assert.equal(seen[0].body.thinking, undefined);
  assert.equal(seen[1].body.messages[2].name, "calculate");
});

const envOf = (o) => (k) => o[k];

test("models: Pro for Ask, Flash for the review, each overridable, a Mistral or Claude name never sent", () => {
  assert.deepEqual(DEEPSEEK_DEFAULT, { ask: "deepseek-v4-pro", review: "deepseek-flash" });
  assert.equal(deepseekModel(envOf({}), "ask"), "deepseek-v4-pro");
  assert.equal(deepseekModel(envOf({}), "review"), "deepseek-flash");
  assert.equal(deepseekModel(envOf({ LLM_MODEL_ASK: "deepseek-flash" }), "ask"), "deepseek-flash");
  assert.equal(deepseekModel(envOf({ LLM_MODEL_ASK: "deepseek-flash" }), "review"), "deepseek-flash");
  assert.equal(deepseekModel(envOf({ LLM_MODEL: "deepseek-v4-pro" }), "review"), "deepseek-v4-pro");
  assert.equal(deepseekModel(envOf({ LLM_MODEL: "deepseek-flash", LLM_MODEL_ASK: "deepseek-v4-pro" }), "ask"), "deepseek-v4-pro");
  assert.equal(deepseekModel(envOf({ LLM_MODEL: "mistral-large-latest" }), "ask"), "deepseek-v4-pro");
  assert.equal(deepseekModel(envOf({ LLM_MODEL_REVIEW: "Magistral-medium", LLM_MODEL: "claude-sonnet-5-5" }), "review"), "deepseek-flash");
  // MISTRAL_MODEL is never read for DeepSeek
  assert.equal(deepseekModel(envOf({ MISTRAL_MODEL: "mistral-small-latest" }), "ask"), "deepseek-v4-pro");
});

test("base URL and the thinking switch: only DeepSeek's own API is sent thinking off", () => {
  assert.equal(deepseekBase(envOf({})), "https://api.deepseek.com");
  assert.equal(deepseekBase(envOf({ LLM_BASE_URL: "https://api.deepseek.com/v1/" })), "https://api.deepseek.com/v1");
  assert.deepEqual(deepseekExtra("https://api.deepseek.com"), OFF);
  assert.deepEqual(deepseekExtra("https://api.deepseek.com/v1"), OFF);
  assert.deepEqual(deepseekExtra("https://openrouter.ai/api/v1"), {});
  assert.deepEqual(deepseekExtra("not a url"), {});
});

test("provider: DeepSeek whenever LLM_API_KEY is set, unless AI_PROVIDER names another", () => {
  assert.equal(provider(envOf({ LLM_API_KEY: "d" })), "deepseek");
  assert.equal(provider(envOf({ LLM_API_KEY: "d", MISTRAL_API_KEY: "m", ANTHROPIC_API_KEY: "a" })), "deepseek");
  assert.equal(provider(envOf({ LLM_API_KEY: "d", MISTRAL_API_KEY: "m", AI_PROVIDER: "Mistral" })), "mistral");
  assert.equal(provider(envOf({ LLM_API_KEY: "d", AI_PROVIDER: "anthropic" })), "anthropic");
  assert.equal(provider(envOf({ MISTRAL_API_KEY: "m", AI_PROVIDER: "deepseek" })), "deepseek");
  assert.equal(provider(envOf({ LLM_API_KEY: "d", AI_PROVIDER: "openai" })), "deepseek");
  // as before DeepSeek came in
  assert.equal(provider(envOf({ MISTRAL_API_KEY: "m" })), "mistral");
  assert.equal(provider(envOf({ ANTHROPIC_API_KEY: "a" })), "anthropic");
  assert.equal(provider(envOf({ MISTRAL_API_KEY: "m", ANTHROPIC_API_KEY: "a" })), "mistral");
  assert.equal(provider(envOf({})), "mistral");
});

test("fallback order: the others with a key, DeepSeek before Mistral, never Claude", () => {
  const all = envOf({ LLM_API_KEY: "d", MISTRAL_API_KEY: "m", ANTHROPIC_API_KEY: "a" });
  assert.deepEqual(fallbacks(all, "deepseek"), ["mistral"]);
  assert.deepEqual(fallbacks(all, "anthropic"), ["deepseek", "mistral"]);
  assert.deepEqual(fallbacks(all, "mistral"), ["deepseek"]);
  assert.deepEqual(fallbacks(envOf({ LLM_API_KEY: "d" }), "deepseek"), []);
  assert.deepEqual(fallbacks(envOf({ ANTHROPIC_API_KEY: "a", MISTRAL_API_KEY: "m" }), "anthropic"), ["mistral"]);
});

test("firstThatAnswers: DeepSeek down means Mistral answers and the steps say why; the last failure is thrown", async () => {
  const quiet = () => {};
  const tried = [];
  const r = await firstThatAnswers(envOf({ LLM_API_KEY: "d", MISTRAL_API_KEY: "m" }), "ask", async (p) => {
    tried.push(p);
    if (p === "deepseek") throw new Error("DeepSeek 503: Server   overloaded");
    return "answer";
  }, quiet);
  assert.deepEqual(tried, ["deepseek", "mistral"]);
  assert.equal(r.used, "mistral");
  assert.equal(r.out, "answer");
  assert.deepEqual(r.skipped, ["DeepSeek was unavailable (DeepSeek 503: Server overloaded); answered with Mistral"]);
  // DeepSeek alone: its error reaches the owner
  await assert.rejects(firstThatAnswers(envOf({ LLM_API_KEY: "d" }), "ask", async () => { throw new Error("DeepSeek 401: bad key"); }, quiet), /DeepSeek 401/);
  // a healthy first provider is the only one called
  const once = [];
  const ok = await firstThatAnswers(envOf({ LLM_API_KEY: "d", MISTRAL_API_KEY: "m" }), "review", async (p) => { once.push(p); return 1; }, quiet);
  assert.deepEqual(once, ["deepseek"]);
  assert.deepEqual(ok.skipped, []);
});

test("modelRefused: a refused model name moves Ask to Flash; a bad key, no balance or a rate limit does not", () => {
  assert.equal(modelRefused(new Error("DeepSeek 400: Model Not Exist")), true);
  assert.equal(modelRefused(new Error("DeepSeek 422: Invalid Parameters")), true);
  assert.equal(modelRefused(new Error("DeepSeek 401: Authentication Fails")), false);
  assert.equal(modelRefused(new Error("DeepSeek 402: Insufficient Balance")), false);
  assert.equal(modelRefused(new Error("DeepSeek 429: Rate Limit Reached")), false);
  assert.equal(modelRefused(new Error("Mistral 400: bad")), false);
});
