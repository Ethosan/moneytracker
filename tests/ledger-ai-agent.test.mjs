// The Ask chat's tool loop (supabase/functions/ledger-ai/agent.ts) against a fake model: the
// model asks for a lookup and a calculation, gets exact results back, and answers; a bad tool call
// comes back as an error it can recover from; a model that never stops is cut off.
import test from "node:test";
import assert from "node:assert/strict";
import { mistralAgent, claudeAgent } from "../supabase/functions/ledger-ai/agent.ts";

const tools = [{ name: "calculate", description: "x", parameters: { type: "object" } }, { name: "search_transactions", description: "x", parameters: { type: "object" } }];
const run = (name, args) => {
  if (name === "calculate") { if (args.expression === "bad") throw new Error("Only numbers allowed."); return { result: { result: 42 }, label: `Worked out ${args.expression} = 42` }; }
  if (name === "search_transactions") return { result: { matched: 3, total_of_matched: 61.5 }, label: `Looked up ${args.note}: 3 rows, 61.5` };
  throw new Error("Unknown tool: " + name);
};

// a scripted Mistral: each entry is the message of one reply, in order
function fakeMistral(replies) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); seen.push(body);
    const message = replies[seen.length - 1] || { content: "(out of script)" };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }] }), text: async () => "" };
  };
  return { fetchImpl, seen };
}

test("Mistral loop: lookup, calculation (string and object arguments), then the answer", async () => {
  const f = fakeMistral([
    { content: "", tool_calls: [{ id: "c1", function: { name: "search_transactions", arguments: '{"note":"claude","group_by":"month"}' } }] },
    { content: "", tool_calls: [{ id: "c2", function: { name: "calculate", arguments: { expression: "61.5/3" } } }] },
    { content: "You spent **$61.50** on Claude." },
  ]);
  const out = await mistralAgent({ fetchImpl: f.fetchImpl, key: "k", model: "m", system: "sys", messages: [{ role: "user", content: "claude?" }], tools, run });
  assert.equal(out.text, "You spent **$61.50** on Claude.");
  assert.deepEqual(out.steps, ["Looked up claude: 3 rows, 61.5", "Worked out 61.5/3 = 42"]);
  assert.equal(out.rounds, 3);
  assert.equal(out.cut, false);
  // the tool results went back under the right ids, after the assistant's tool_calls message
  const third = f.seen[2].messages;
  assert.equal(third[0].role, "system");
  assert.equal(third[2].role, "assistant");
  assert.deepEqual(third[3], { role: "tool", name: "search_transactions", content: JSON.stringify({ matched: 3, total_of_matched: 61.5 }), tool_call_id: "c1" });
  assert.equal(f.seen[0].tools.length, 2);
  assert.equal(f.seen[0].tool_choice, "auto");
});

test("Mistral loop: a failing tool returns an error the model can correct", async () => {
  const f = fakeMistral([
    { content: "", tool_calls: [{ id: "c1", function: { name: "calculate", arguments: '{"expression":"bad"}' } }] },
    { content: "Sorry, that was not a sum." },
  ]);
  const out = await mistralAgent({ fetchImpl: f.fetchImpl, key: "k", model: "m", system: "sys", messages: [], tools, run });
  assert.equal(out.steps[0], "calculate failed: Only numbers allowed.");
  assert.equal(JSON.parse(f.seen[1].messages[2].content).error, "Only numbers allowed.");
  assert.equal(out.text, "Sorry, that was not a sum.");
});

test("Mistral loop: a model that keeps calling tools is made to answer after the round cap", async () => {
  const replies = Array.from({ length: 20 }, () => ({ content: "", tool_calls: [{ id: "x", function: { name: "calculate", arguments: '{"expression":"1+1"}' } }] }));
  const f = fakeMistral(replies);
  const out = await mistralAgent({ fetchImpl: f.fetchImpl, key: "k", model: "m", system: "sys", messages: [], tools, run });
  assert.equal(out.rounds, 9);
  assert.equal(f.seen[8].tool_choice, "none");
  assert.equal(out.steps.length, 8);
});

test("Mistral loop: an upstream error is thrown with its status", async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, text: async () => "slow down", json: async () => ({}) });
  await assert.rejects(mistralAgent({ fetchImpl, key: "k", model: "m", system: "s", messages: [], tools, run }), /Mistral 429: slow down/);
});

test("Claude loop: tool_use blocks become tool_result blocks, then text", async () => {
  const replies = [
    { stop_reason: "tool_use", model: "claude-x", content: [{ type: "text", text: "Let me check." }, { type: "tool_use", id: "t1", name: "search_transactions", input: { note: "claude" } }] },
    { stop_reason: "end_turn", model: "claude-x", content: [{ type: "text", text: "**$61.50** on Claude." }] },
  ];
  const seen = [];
  const create = async (p) => { seen.push(p); return replies[seen.length - 1]; };
  const out = await claudeAgent({ create, model: "claude-x", system: "sys", messages: [{ role: "user", content: "claude?" }], tools, run });
  assert.equal(out.text, "**$61.50** on Claude.");
  assert.deepEqual(out.steps, ["Looked up claude: 3 rows, 61.5"]);
  assert.equal(seen[1].messages[1].role, "assistant");
  assert.equal(seen[1].messages[2].content[0].type, "tool_result");
  assert.equal(seen[1].messages[2].content[0].tool_use_id, "t1");
  assert.equal(seen[0].tools[0].input_schema.type, "object");
});
