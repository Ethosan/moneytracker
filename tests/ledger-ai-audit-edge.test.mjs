// Figure-audit edge cases found by stress-testing (26 Oct 2026): a whole-number percentage is a
// figure even when small (a hand-made "22%" used to pass as a count), a calculated 22 vouches for
// it, and a reply with no words never goes out as a blank bubble.
import test from "node:test";
import assert from "node:assert/strict";
import { mistralAgent, claudeAgent, numbersIn, unknownNumbers } from "../supabase/functions/ledger-ai/agent.ts";

const tools = [{ name: "calculate", description: "x", parameters: { type: "object" } }];
const call = (id, expr) => ({ id, function: { name: "calculate", arguments: JSON.stringify({ expression: expr }) } });
function fakeMistral(replies) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); seen.push(body);
    const message = typeof replies === "function" ? replies(seen.length) : (replies[seen.length - 1] || { content: "(out of script)" });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }] }), text: async () => "" };
  };
  return { fetchImpl, seen };
}

test("a percentage is a figure even when it is a small whole number", () => {
  assert.deepEqual(numbersIn("22% of income, 22 rides, 7.5%, 100 %, on the 12th"), [22, 7.5, 100]);
  // the given side keeps every number, so a result of 22 can vouch for 22%
  assert.deepEqual(numbersIn('{"result":22,"exact":22.0004}', true), [22, 22.0004]);
  assert.deepEqual(numbersIn('{"result":22,"exact":22.0004}'), [22.0004]);
  assert.deepEqual(unknownNumbers("22%", new Set([22])), []);
  assert.deepEqual(unknownNumbers("22%", new Set([21.6])), [22]);
});

test("Mistral loop: a hand-made 22% is caught, recomputed and then vouched for", async () => {
  const f = fakeMistral([
    { content: "Subscriptions are 22% of income." },
    { content: "", tool_calls: [call("c", "333.23/1514.68*100")] },
    { content: "Subscriptions are 22% of income." },
  ]);
  const run = (name, args) => ({ result: { expression: args.expression, result: 22, exact: 22.0004 }, label: `Worked out ${args.expression} = 22` });
  const out = await mistralAgent({ fetchImpl: f.fetchImpl, key: "k", model: "m", system: "s", messages: [{ role: "user", content: "share of income?" }], tools, run });
  assert.equal(out.rounds, 3);
  assert.deepEqual(out.unverified, []);
  assert.deepEqual(out.steps, ["Caught 1 figure worked out by hand (22), recomputing", "Worked out 333.23/1514.68*100 = 22", "Rechecked every figure against the lookups"]);
  // a bare 22 is still a count
  const g = fakeMistral([{ content: "You took 22 Grab rides." }]);
  const out2 = await mistralAgent({ fetchImpl: g.fetchImpl, key: "k", model: "m", system: "s", messages: [{ role: "user", content: "rides?" }], tools, run });
  assert.equal(out2.rounds, 1);
  assert.deepEqual(out2.unverified, []);
});

test("a model that never answers in words gets a plain fallback, not a blank bubble", async () => {
  const f = fakeMistral(() => ({ content: "", tool_calls: [call("c", "1+1")] }));
  const run = () => ({ result: { result: 2 }, label: "Worked out 1+1 = 2" });
  const out = await mistralAgent({ fetchImpl: f.fetchImpl, key: "k", model: "m", system: "s", messages: [{ role: "user", content: "q" }], tools, run });
  assert.match(out.text, /couldn't finish working this out/);
  assert.equal(out.steps.at(-2), "The model ran out of lookups without answering");
  assert.equal(f.seen.at(-1).tool_choice, "none");
  const claude = await claudeAgent({ create: async () => ({ content: [], stop_reason: "end_turn" }), model: "m", system: "s", messages: [{ role: "user", content: "q" }], tools, run });
  assert.match(claude.text, /couldn't finish/);
});

test("a calculator result may be rounded, or rounded up or down, in the answer", async () => {
  const f = fakeMistral([{ content: "", tool_calls: [call("c", "100000/569.18")] }, { content: "About **176 months** (175.7), or 175 at the least; 12.75 is 13%." }, { content: "About **176 months** (175.7), or 175 at the least; 12.75 is 13%." }]);
  const run = (name, args) => ({ result: { expression: args.expression, result: 175.69, exact: 175.6911 }, label: "Worked out" });
  const out = await mistralAgent({ fetchImpl: f.fetchImpl, key: "k", model: "m", system: "s", messages: [{ role: "user", content: "Totals: 12.75" }], tools, run });
  // 176, 175.7 and 175 come from the calculation; 13 is a hand rounding of a snapshot figure, so it is still caught
  assert.deepEqual(out.unverified, [13]);
});
