// 20bucks AI: reviews new entries for likely mistakes, answers questions about your spending,
// and proposes changes from the Ask chat. A proposal is only data: the app shows it with an
// Apply button and nothing in the ledger changes until the owner taps it.
//
// Ask works with tools (engine.ts, agent.ts): the model gets the live snapshot and exact monthly
// totals, and for anything finer it calls search_transactions, month_summary, account_summary,
// venue_entries and calculate. Every figure it quotes was computed here, with the rules the app's
// own screens use, so the chat and the app agree and no arithmetic is left to the model. The
// answer comes back with `steps`, the lookups made, which the app shows under the reply.
//
// The API key lives here as a Supabase secret, never in the app. OPEN_TO_ALL is true:
// any signed-in account can use it (each capped at CALL_LIMIT calls an hour); set it to
// false to allow only the accounts on the AI_ALLOWED_IDS allowlist, since sign-in creates
// an account for anyone and an open function lets a stranger spend the key.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   MISTRAL_API_KEY     to use Mistral (the default when it is set)
//   ANTHROPIC_API_KEY   to use Claude
//   AI_PROVIDER         optional: "mistral" or "anthropic", to choose when both keys are set
//   MISTRAL_MODEL       optional, default mistral-small-latest
//   ANTHROPIC_MODEL     optional, default claude-opus-5-5
//   AI_DAILY_LIMIT      optional, AI calls per day for all accounts together (default 300)
//   AI_ALLOWED_IDS      comma-separated user ids allowed to call this function when
//                       OPEN_TO_ALL is false (Supabase dashboard -> Authentication -> Users
//                       -> copy the UUID); with it unset the function then answers nobody.
// Exact versions, each at least two weeks old when pinned: a fresh release can carry a
// compromised package, and an unpinned import pulls whatever was published that hour.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import Anthropic from "npm:@anthropic-ai/sdk@0.132.1";
import { loadLedger, overview, runTool, TOOLS, plainCat } from "./engine.ts";
import { mistralAgent, claudeAgent } from "./agent.ts";
import type { Turn, Run } from "./agent.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Item = { i: number; d: string; t: string; amt: number; cat: string; note: string };

const REVIEW_SYSTEM = `You check a personal spending log (Singapore dollars) for likely data-entry mistakes.
Each entry has an index i, date d, type t (exp = spending, inc = income), amount amt, category cat and note.
When the owner's usual patterns are provided, compare each entry with them. An entry that matches the
usual type, amount and category is a habit, not a mistake: a subscription that is always the same amount
is fine. A note that is usually income is income even if the note sounds like an expense, and a category
the owner usually uses for income is an income category even if its name sounds like an expense.
Each category also has a type the owner set (income or spending); an entry whose type matches its category's type is correct.
Flag only entries that are probably wrong: a category that clearly does not fit the note, an amount that looks
like a typo for that kind of purchase, income logged as spending or the reverse, or a note that contradicts the
amount. Unusual but plausible spending is not a mistake. When unsure, leave it out; an empty list is a good answer.
For a category fix, use a name exactly as it appears in the allowed categories. Write each issue as one short,
plain sentence addressed to the owner.
Reply with JSON only: {"findings":[{"i":0,"issue":"...","cat":"optional category","amt":optional number}]}`;

const ASK_SYSTEM = `You answer questions about the owner's personal finances (a Singapore-dollar ledger). The first
message holds a live snapshot from the app and EXACT MONTHLY TOTALS. For everything else you have tools that read the
ledger and do arithmetic. Every number you give must come from the snapshot, the totals or a tool result.

Numbers:
- Never add, subtract, average, compare or convert numbers yourself. Any figure not printed in the first message comes
  from search_transactions or month_summary; any arithmetic on figures goes through calculate. Copy results exactly as
  returned; never round differently, estimate or fill a gap from memory.
- A question about one thing (a shop, product, service, subscription, person, category or tag): call search_transactions
  with a note and/or category filter, group_by "month" and limit 200. If nothing matches, try a shorter or alternative word
  (a brand and its maker, a nickname) before saying so, and say what you searched. Answer with the total, the month-by-month
  table (paste groups_markdown) and the dated entries (paste rows_markdown, or the relevant rows when there are many).
- "This month", "last month", "this year" are relative to the Today date in the first message. Months are YYYY-MM.
- Spending is the owner's own share of split bills. Prop-firm fees, PayLater interest and subscriptions are spending rows
  like any other. Transfers between the owner's wallets are not spending.
- Savings means income minus net spending (spending less what friends paid back): each month has a saved figure, and the
  averages over complete months are given, so answer "how much should I save" questions from those and calculate.
- When something cannot be found, say exactly what you searched and that nothing matched. Never guess a figure.

Writing:
- Short and direct. Bold the key figure. One sentence of interpretation (what stands out, whether it is worth it).
- Several rows: a markdown table (header row, |---| row, one row per item). Keep tool tables as returned.
- Formulas only in LaTeX wrapped in $$...$$ or \\(...\\), never single $ signs, since amounts are written with $ (like $500).
  Never use LaTeX tabular.
- This is a conversation: a short follow-up ("break it down", "and last month?", "by month") continues the previous topic.

You can propose changes to transactions: adding one, editing one, or deleting one. Propose them when the owner asks
you to log, fix, move, recategorise or remove something, or when they agree to a fix you suggested. Do not propose
changes they did not ask for. Nothing changes when you propose: the app shows each change with an Apply button and
the owner decides, so say so in one short line ("Tap Apply to make the change.") and never claim it is already done.
To edit or delete, first find the row with search_transactions: only rows that come back with an id can be changed.
For the category and wallet names, use account_summary with section "categories". Write your answer first, then put
the changes at the very end in a fenced block tagged changes, holding a JSON array:
\`\`\`changes
[{"op":"add","d":"2026-10-21","t":"exp","amt":12.5,"cat":"<exact category>","note":"Lunch","why":"short reason"},
 {"op":"edit","id":"<id from a tool result>","amt":15,"cat":"<exact category>","note":"...","d":"YYYY-MM-DD","t":"exp","why":"..."},
 {"op":"delete","id":"<id from a tool result>","why":"..."}]
\`\`\`
For add: d, t (exp or inc), amt and cat are required; note and acct (a wallet from the categories section) are optional;
d defaults to today. For edit: id, plus only the fields that change. For delete: id. Rows without an id cannot be changed
from here (fees, investment mirrors, transfers), so tell the owner to change those in the app. Categories must be written
exactly as listed, emoji included, and match the type (spending categories for exp, income categories for inc). At most
20 changes. Leave the block out entirely when there is nothing to change.`;

function provider() {
  const want = (Deno.env.get("AI_PROVIDER") || "").toLowerCase();
  if (want === "anthropic" || (!Deno.env.get("MISTRAL_API_KEY") && Deno.env.get("ANTHROPIC_API_KEY"))) return "anthropic";
  return "mistral";
}
const mistralModel = () => Deno.env.get("MISTRAL_MODEL") || "mistral-small-latest";
const claudeModel = () => Deno.env.get("ANTHROPIC_MODEL") || "claude-opus-5-5";
const needKey = (name: string) => { const k = Deno.env.get(name); if (!k) throw new Error(`${name} is not set in the function's secrets.`); return k; };
// on a policy decline the API retries on a fallback model inside the same call
const claudeExtras = { output_config: { effort: "low" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

// The review pass: one plain completion that must come back as JSON.
async function completeJson(system: string, prompt: string) {
  const messages: Turn[] = [{ role: "user", content: prompt }];
  if (provider() === "anthropic") {
    needKey("ANTHROPIC_API_KEY");
    const client = new Anthropic();
    const response = await client.beta.messages.create({ model: claudeModel(), max_tokens: 16000, system, messages, ...claudeExtras } as any);
    if (response.stop_reason === "refusal") throw new Error("The model declined this request.");
    return { text: response.content.map((b: any) => (b.type === "text" ? b.text : "")).join(""), model: response.model, cut: response.stop_reason === "max_tokens" };
  }
  const key = needKey("MISTRAL_API_KEY"), model = mistralModel();
  const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, ...messages], temperature: 0.2, max_tokens: 2000, response_format: { type: "json_object" } }),
  });
  if (!r.ok) throw new Error(`Mistral ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  return { text: String(data.choices?.[0]?.message?.content ?? ""), model, cut: data.choices?.[0]?.finish_reason === "length" };
}

function firstJson(text: string) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

// The changes block at the end of an answer, checked against the ledger: unknown ids, made-up
// categories, impossible dates and amounts are dropped, so the app only ever shows real proposals.
type Change = { op: "add" | "edit" | "delete"; id?: string; d?: string; t?: "exp" | "inc"; amt?: number; cat?: string; note?: string; acct?: string; why?: string };
function takeChanges(text: string, L: { ids: Set<string>; byId: Map<string, { t: string; cat: string }>; cats: Map<string, string>; accts: Set<string> }) {
  // the block can sit anywhere (models often add a line after it), or be cut off at the end
  const m = text.match(/```changes\s*([\s\S]*?)```/) || text.match(/```changes\s*([\s\S]*)$/);
  if (!m) return { answer: text.trim(), changes: [] as Change[] };
  const answer = (text.slice(0, m.index) + text.slice((m.index || 0) + m[0].length)).trim();
  const none = (why: string) => ({ answer: (answer ? answer + "\n\n" : "") + "*" + why + "*", changes: [] as Change[] });
  let raw: unknown;
  try { raw = JSON.parse(m[1].trim()); } catch { return none("The proposed changes didn't come through in full, so none are shown. Ask again to get them."); }
  // categories as the model writes them often lose or gain the emoji; match on the name
  const catKey = (c: string) => plainCat(c).replace(/️/g, "").trim().toLowerCase();
  const catByKey = new Map<string, string>([...L.cats.keys()].map((n) => [catKey(n), n]));
  const findCat = (c: unknown) => typeof c !== "string" ? undefined : L.cats.has(c) ? c : catByKey.get(catKey(c));
  const okDate = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + "T00:00:00Z")) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
  const okAmt = (a: unknown) => typeof a === "number" && isFinite(a) && a > 0 && a < 1e7;
  const str = (v: unknown, n: number) => String(v).replace(/\s+/g, " ").trim().slice(0, n);
  const changes: Change[] = [];
  for (const c of (Array.isArray(raw) ? raw : []).slice(0, 20) as any[]) {
    if (!c || typeof c !== "object") continue;
    const why = typeof c.why === "string" ? str(c.why, 200) : undefined;
    if (c.op === "delete") { if (L.ids.has(c.id)) changes.push({ op: "delete", id: c.id, why }); continue; }
    if (c.op !== "add" && c.op !== "edit") continue;
    const o: Change = { op: c.op, why };
    if (c.op === "edit") { if (!L.ids.has(c.id)) continue; o.id = c.id; }
    if (c.t === "exp" || c.t === "inc") o.t = c.t;
    if (c.d != null) { if (!okDate(c.d)) continue; o.d = c.d; }
    if (c.amt != null) { if (!okAmt(c.amt)) continue; o.amt = Math.round(c.amt * 100) / 100; }
    if (c.cat != null) { const cat = findCat(c.cat); if (!cat) continue; o.cat = cat; }
    if (typeof c.note === "string") o.note = str(c.note, 120);
    if (typeof c.acct === "string" && L.accts.has(c.acct)) o.acct = c.acct;
    if (o.op === "add") {
      if (!o.amt || !o.cat) continue;
      o.t = o.t || (L.cats.get(o.cat) as "exp" | "inc");
    }
    // a category of the other type would file spending as income or the reverse; for an edit
    // that changes only one of the two, check against what the entry has now
    const cur = o.op === "edit" ? L.byId.get(o.id as string) : undefined;
    const effT = o.t ?? cur?.t, effCat = o.cat ?? cur?.cat;
    if (effCat && effT && L.cats.has(effCat) && L.cats.get(effCat) !== effT) continue;
    if (o.op === "edit" && o.t == null && o.d == null && o.amt == null && o.cat == null && o.note == null && o.acct == null) continue;
    changes.push(o);
  }
  if (!changes.length && Array.isArray(raw) && raw.length) return none("None of the proposed changes matched your ledger, so nothing is shown.");
  return { answer, changes };
}

// Usage caps: the AI spends the owner's API credits and the app is shared. Each call is recorded
// by the ai_take_call() database function, so the caps hold across cold starts and copies of this
// function: CALL_LIMIT per account per hour, and DAILY_LIMIT for all accounts together (the
// AI_DAILY_LIMIT secret overrides it). A monthly spending limit in the Mistral console is the backstop.
const CALL_LIMIT = 120;
const DAILY_LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT")) || 300;
// Fallback cap kept in memory, used only if the database function can't be reached.
const CALLS = new Map<string, { n: number; reset: number }>();
const CALL_WINDOW_MS = 3600000;
// Open to every signed-in account (2026-10-24): the app is a personal money tracker, so the
// owner wants all accounts to work without an allowlist. Rate caps below still apply per account
// and per day, and a monthly spending limit at the provider is the backstop.
const OPEN_TO_ALL = true;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // only a signed-in user of this project may spend the API key
  const auth = req.headers.get("Authorization") || "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: "Sign in first." }, 401);

  // With OPEN_TO_ALL off, only the allowlist may spend the API key: anyone can create an
  // account on the project, so "any signed-in user" is not a gate.
  if (!OPEN_TO_ALL) {
    const allowed = (Deno.env.get("AI_ALLOWED_IDS") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!allowed.length) return json({ error: "The AI assistant is not enabled. The owner can allow an account by setting the AI_ALLOWED_IDS secret (see the README)." }, 403);
    if (!allowed.includes(user.id)) return json({ error: "The AI assistant is not enabled for this account." }, 403);
  }

  const { data: slot, error: slotErr } = await sb.rpc("ai_take_call", { per_user_hour: CALL_LIMIT, all_users_day: DAILY_LIMIT });
  if (slotErr) {
    console.error("ai_take_call failed, using the in-memory cap:", slotErr.message);
    const now = Date.now();
    const rec = CALLS.get(user.id);
    if (rec && rec.reset > now) { if (rec.n >= CALL_LIMIT) return json({ error: "Too many AI requests. Try again in a little while." }, 429); rec.n++; }
    else CALLS.set(user.id, { n: 1, reset: now + CALL_WINDOW_MS });
    if (CALLS.size > 1000) { for (const [k, v] of CALLS) { if (v.reset <= now) CALLS.delete(k); } }
  } else if (slot === "user") {
    return json({ error: "Too many AI requests from this account. Try again in a little while." }, 429);
  } else if (slot === "all") {
    return json({ error: "The AI assistant has reached today's limit. Try again tomorrow." }, 429);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  try {
    if (body.action === "review") {
      // capped field by field, so a request can't pad the prompt with huge notes
      const items: Item[] = (Array.isArray(body.items) ? body.items : []).slice(0, 200).map((x: any) => ({
        i: Number(x && x.i), d: String((x && x.d) || "").slice(0, 10), t: x && x.t === "inc" ? "inc" : "exp",
        amt: Math.round((Number(x && x.amt) || 0) * 100) / 100, cat: String((x && x.cat) || "").slice(0, 80), note: String((x && x.note) || "").slice(0, 200),
      }));
      // Categories arrive as {name, type} so the model knows which are income and which are
      // spending; plain strings (older app versions) are still accepted.
      const catsRaw = (Array.isArray(body.cats) ? body.cats : []).slice(0, 100).map((c: any) =>
        typeof c === "string" ? { name: c, t: "" } : { name: String((c && c.name) || ""), t: (c && c.t) === "inc" ? "inc" : (c && c.t) === "exp" ? "exp" : "" }
      ).filter((c) => c.name);
      const cats = catsRaw.map((c) => c.name);
      const catTypes = catsRaw.filter((c) => c.t).map((c) => `${c.name} = ${c.t === "inc" ? "income" : "spending"}`).join(", ");
      if (!items.length) return json({ findings: [] });
      // Usual patterns computed on the phone from the owner's older entries: per note the usual type,
      // amount and category, per category the usual type. They tell the model what normal looks like, so a
      // steady subscription or income under an expense-sounding category is not flagged.
      const rawHist: any = (body.history && typeof body.history === "object") ? body.history : {};
      const histNotes = (Array.isArray(rawHist.notes) ? rawHist.notes : []).slice(0, 100).map((h: any) => ({
        note: String((h && h.note) || "").slice(0, 80),
        t: h && h.t === "inc" ? "inc" : "exp",
        amt: Math.round((Number(h && h.amt) || 0) * 100) / 100,
        cat: String((h && h.cat) || "").slice(0, 60),
        n: Math.round(Number(h && h.n) || 0),
      })).filter((h) => h.note && h.amt > 0 && h.n > 0);
      const histCats = (Array.isArray(rawHist.cats) ? rawHist.cats : []).slice(0, 100).map((h: any) => ({
        cat: String((h && h.cat) || "").slice(0, 60),
        t: h && h.t === "inc" ? "inc" : "exp",
        n: Math.round(Number(h && h.n) || 0),
      })).filter((h) => h.cat && h.n > 0);
      const histBlock = (histNotes.length || histCats.length)
        ? "\nThe owner's usual patterns, from their own past entries. Notes (note, usual type, usual amount, usual category, times seen):\n" + histNotes.map((h) => JSON.stringify(h)).join("\n") + (histCats.length ? "\nCategories (category, usual type, times seen):\n" + histCats.map((h) => JSON.stringify(h)).join("\n") : "")
        : "";
      const prompt = `Allowed categories: ${JSON.stringify(cats)}${catTypes ? `\nCategory types (income or spending, as the owner set them): ${catTypes}` : ""}\nEntries:\n${items.map((x) => JSON.stringify(x)).join("\n")}${histBlock}`;
      const out = await completeJson(REVIEW_SYSTEM, prompt);
      const parsed = firstJson(out.text);
      // An unreadable or cut-off reply is an error, not "nothing found": the app then keeps these
      // entries for the next review instead of marking them as checked.
      if (out.cut || !parsed || !Array.isArray(parsed.findings)) throw new Error("The review's reply was cut off or couldn't be read, so these entries will be checked next time.");
      const valid = new Set(items.map((x) => x.i)), catSet = new Set(cats);
      const findings = (Array.isArray(parsed?.findings) ? parsed.findings : [])
        .filter((f: { i: unknown; issue: unknown }) => valid.has(Number(f.i)) && typeof f.issue === "string")
        .slice(0, 50)
        .map((f: { i: unknown; issue: string; cat?: unknown; amt?: unknown }) => ({
          i: Number(f.i),
          issue: f.issue.slice(0, 300),
          ...(typeof f.cat === "string" && catSet.has(f.cat) ? { cat: f.cat } : {}),
          ...(typeof f.amt === "number" && f.amt > 0 && f.amt < 1e7 ? { amt: Math.round(f.amt * 100) / 100 } : {}),
        }));
      return json({ findings, provider: provider(), model: out.model });
    }
    if (body.action === "ask") {
      const question = String(body.question || "").slice(0, 1000).trim();
      const context = String(body.context || "").slice(0, 100000);
      const history = (Array.isArray(body.history) ? body.history : []).slice(-10)
        .filter((m: Turn) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m: Turn) => ({ role: m.role, content: m.content.slice(0, 2000) }));
      if (!question) return json({ error: "Ask a question." }, 400);

      // The whole ledger, read with the signed-in user's own session (row level security limits it to
      // their rows), indexed once for the tools. The phone never sends it.
      const { data, error } = await sb.from("ledger_docs").select("id,body");
      if (error) throw new Error("Couldn't read your ledger: " + error.message);
      const doc: Record<string, any> = {};
      (data || []).forEach((d: { id: string; body: any }) => { doc[d.id] = d.body || {}; });
      const L = loadLedger(doc);
      // the app's own date (its time zone), from the snapshot's first line
      const today = (context.match(/Today is (\d{4}-\d{2}-\d{2})/) || [])[1] || new Date().toISOString().slice(0, 10);
      const messages: Turn[] = [
        { role: "user", content: `Today is ${today}. Amounts in SGD.\n\nCURRENT SNAPSHOT (live balances and recent months, from the app):\n${context}\n\n${overview(L, today)}` },
        { role: "assistant", content: "Got it. I'll look anything finer up with the tools and do the arithmetic there. What would you like to know?" },
        ...history,
        { role: "user", content: question },
      ];
      const run: Run = (name, args) => runTool(L, name, args as Record<string, any>);
      const out = provider() === "anthropic"
        ? (needKey("ANTHROPIC_API_KEY"), await claudeAgent({ create: (p) => new Anthropic().beta.messages.create({ ...p, ...claudeExtras } as any), model: claudeModel(), system: ASK_SYSTEM, messages, tools: TOOLS, run }))
        : await mistralAgent({ fetchImpl: fetch, key: needKey("MISTRAL_API_KEY"), model: mistralModel(), system: ASK_SYSTEM, messages, tools: TOOLS, run });

      const byId = new Map<string, { t: string; cat: string }>(L.tx.filter((x) => x.id && L.editable.has(x.id)).map((x) => [x.id as string, { t: x.t, cat: x.cat || "" }]));
      const catTypes = new Map<string, string>([...L.cats.values()].map((c) => [c.name, c.type === "inc" ? "inc" : "exp"]));
      const taken = takeChanges(out.text, { ids: L.editable, byId, cats: catTypes, accts: L.wallets }), changes = taken.changes;
      const answer = out.cut ? taken.answer + "\n\n*The answer hit the length limit and was cut off. Ask for less at once, or ask it to continue.*" : taken.answer;
      return json({ answer, changes, steps: out.steps, provider: provider(), model: out.model });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
