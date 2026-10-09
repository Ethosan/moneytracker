// Ledger AI: reviews new entries for likely mistakes and answers questions about your spending.
// The API key lives here as a Supabase secret, never in the app. Only signed-in users can call it.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   MISTRAL_API_KEY     to use Mistral (the default when it is set)
//   ANTHROPIC_API_KEY   to use Claude
//   AI_PROVIDER         optional: "mistral" or "anthropic", to choose when both keys are set
//   MISTRAL_MODEL       optional, default mistral-small-latest
//   ANTHROPIC_MODEL     optional, default claude-opus-5-5
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Item = { i: number; d: string; t: string; amt: number; cat: string; note: string };
type Turn = { role: "user" | "assistant"; content: string };

const REVIEW_SYSTEM = `You check a personal spending log (Singapore dollars) for likely data-entry mistakes.
Each entry has an index i, date d, type t (exp = spending, inc = income), amount amt, category cat and note.
Flag only entries that are probably wrong: a category that clearly does not fit the note, an amount that looks
like a typo for that kind of purchase, income logged as spending or the reverse, or a note that contradicts the
amount. Unusual but plausible spending is not a mistake. When unsure, leave it out; an empty list is a good answer.
For a category fix, use a name exactly as it appears in the allowed categories. Write each issue as one short,
plain sentence addressed to the owner.
Reply with JSON only: {"findings":[{"i":0,"issue":"...","cat":"optional category","amt":optional number}]}`;

const ASK_SYSTEM = `You answer questions about the owner's personal finances using only the data provided: a current snapshot,
exact totals worked out for you, and every transaction and entry. For any sum, use the exact totals rather than adding rows yourself;
use the rows to look up specific purchases, dates and patterns.
Amounts are Singapore dollars unless marked US$.
This is a conversation: a short follow-up ("break it down", "I mean the prop firms", "and last month?") is about
the topic of the previous messages, so answer it in that context instead of starting over.
When asked for a breakdown, list every item with its own numbers (for prop firms: each firm's fees paid,
payouts received and net result; by month when asked), then a one-line total. Use short lists, bold the key
figure, and add one sentence of interpretation (is it worth it, what stands out).
If the summary does not contain what is needed, say exactly what is missing instead of guessing. You cannot change
any data; if a change would help, say what to change and the owner will do it in the app.`;

function provider() {
  const want = (Deno.env.get("AI_PROVIDER") || "").toLowerCase();
  if (want === "anthropic" || (!Deno.env.get("MISTRAL_API_KEY") && Deno.env.get("ANTHROPIC_API_KEY"))) return "anthropic";
  return "mistral";
}

async function mistral(system: string, messages: Turn[], asJson: boolean) {
  const key = Deno.env.get("MISTRAL_API_KEY");
  if (!key) throw new Error("MISTRAL_API_KEY is not set in the function's secrets.");
  const model = Deno.env.get("MISTRAL_MODEL") || "mistral-small-latest";
  const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, ...messages],
      temperature: 0.2,
      max_tokens: 2000,
      ...(asJson ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!r.ok) throw new Error(`Mistral ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  return { text: String(data.choices?.[0]?.message?.content ?? ""), model };
}

async function claude(system: string, messages: Turn[]) {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) throw new Error("ANTHROPIC_API_KEY is not set in the function's secrets.");
  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-opus-5-5";
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    system,
    messages,
    output_config: { effort: "low" },
    // on a policy decline the API retries on a fallback model inside the same call
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);
  if (response.stop_reason === "refusal") throw new Error("The model declined this request.");
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return { text, model: response.model };
}

async function complete(system: string, messages: Turn[], asJson: boolean) {
  return provider() === "anthropic" ? await claude(system, messages) : await mistral(system, messages, asJson);
}

function firstJson(text: string) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}


// The whole ledger, read here with the signed-in user's own session (row level security
// limits it to their rows), so every question can use all of it without the phone sending it.
// Exact totals are worked out here: language models are unreliable at adding up long lists.
type Tx = { d: string; t: string; amt: number; cat?: string; sub?: string; note?: string; acct?: string; pm?: string; plp?: string; tags?: string[]; split?: { mine: number; person: string }; from?: string; to?: string; inst?: { n: number; fee?: number } };
const r2 = (n: number) => Math.round(n * 100) / 100;
const plainCat = (c = "") => c.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, "");
const LIMIT = 260000; // characters of row data, comfortably inside the model's context

async function fullLedger(sb: ReturnType<typeof createClient>) {
  const { data, error } = await sb.from("ledger_docs").select("id,body");
  if (error) throw new Error("Couldn't read your ledger: " + error.message);
  const doc: Record<string, any> = {};
  (data || []).forEach((d: { id: string; body: any }) => { doc[d.id] = d.body || {}; });
  const tx: Tx[] = Object.keys(doc).filter((k) => k.startsWith("tx-")).flatMap((k) => doc[k].items || []).filter((x: Tx) => x && x.d)
    .sort((a: Tx, b: Tx) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const mine = (x: Tx) => (x.t === "exp" && x.split && x.split.mine >= 0 ? x.split.mine : x.amt);
  const meta = doc.meta || {}, out: string[] = [];

  // exact totals
  const byMonth: Record<string, Record<string, number>> = {}, inMonth: Record<string, Record<string, number>> = {}, byYear: Record<string, { spent: number; income: number }> = {}, notes: Record<string, { n: number; s: number; cat: string }> = {};
  tx.forEach((x) => {
    const m = x.d.slice(0, 7), y = x.d.slice(0, 4), c = plainCat(x.cat);
    byYear[y] = byYear[y] || { spent: 0, income: 0 };
    if (x.t === "exp") {
      (byMonth[m] = byMonth[m] || {})[c] = r2((byMonth[m][c] || 0) + mine(x)); byYear[y].spent += mine(x);
      const k = (x.note || "").trim(); if (k) { const o = notes[k] = notes[k] || { n: 0, s: 0, cat: c }; o.n++; o.s += mine(x); }
    } else if (x.t === "inc") { (inMonth[m] = inMonth[m] || {})[c] = r2((inMonth[m][c] || 0) + x.amt); byYear[y].income += x.amt; }
  });
  out.push("EXACT TOTALS (use these numbers rather than adding rows yourself)");
  Object.keys(byYear).sort().forEach((y) => out.push(`Year ${y}: spent ${r2(byYear[y].spent)}, income ${r2(byYear[y].income)}`));
  Object.keys(byMonth).sort().forEach((m) => {
    const c = byMonth[m], tot = r2(Object.values(c).reduce((a, b) => a + b, 0));
    out.push(`Spent ${m}: total ${tot}; ` + Object.keys(c).sort((a, b) => c[b] - c[a]).map((k) => `${k} ${c[k]}`).join(", "));
  });
  Object.keys(inMonth).sort().forEach((m) => { const c = inMonth[m]; out.push(`Income ${m}: ` + Object.keys(c).map((k) => `${k} ${c[k]}`).join(", ")); });
  const topNotes = Object.keys(notes).sort((a, b) => notes[b].s - notes[a].s).slice(0, 40);
  if (topNotes.length) out.push("Biggest notes, all time: " + topNotes.map((k) => `${k} (${notes[k].cat}) ${notes[k].n}x ${r2(notes[k].s)}`).join("; "));

  // investments, prop firms and poker, per account
  const venues = meta.venues || {}, led = (doc.ledger && doc.ledger.entries) || [];
  const perV: Record<string, { type: string; inn: number; outv: number; n: number; last: string }> = {};
  led.forEach((e: any) => {
    const v = perV[e.venue] = perV[e.venue] || { type: (venues[e.venue] && venues[e.venue].type) || "broker", inn: 0, outv: 0, n: 0, last: "" };
    if (e.f === "in") v.inn += e.amt; else if (e.f === "out") v.outv += e.amt; v.n++; if (e.d > v.last) v.last = e.d;
  });
  Object.keys(perV).forEach((k) => { const v = perV[k]; out.push(`${v.type} ${k}: paid in ${r2(v.inn)}, taken out ${r2(v.outv)}, net ${r2(v.outv - v.inn)} (cash basis), ${v.n} entries, last ${v.last}`); });

  // the rows themselves
  const rows: string[] = [];
  rows.push("\nINVESTMENT, PROP FIRM AND POKER ENTRIES: date | account | in (money paid in / fee / buy-in) or out (money taken out / payout / win) or bal (balance) | amount | note");
  led.slice().sort((a: any, b: any) => (a.d < b.d ? -1 : 1)).forEach((e: any) => rows.push(`${e.d} | ${e.venue} | ${e.f} | ${r2(e.amt)} | ${e.note || ""}`));
  const debts = (doc.debts && doc.debts.entries) || [];
  if (debts.length) {
    rows.push("\nMONEY BETWEEN PEOPLE: date | person | amount (positive: they owe me) | note");
    debts.forEach((x: any) => rows.push(`${x.d} | ${x.person} | ${r2(x.amt)} | ${x.note || ""}`));
  }
  const bills = (doc.bills && doc.bills.entries) || [];
  if (bills.length) {
    rows.push("\nPAYLATER BILLS: provider | period from | instalments | fee | payments (date amount)");
    bills.forEach((b: any) => rows.push(`${b.prov || "GrabPay Later"} | ${b.from} | ${b.n || 1} | ${b.fee || 0} | ${(b.payments || []).map((p: any) => p.d + " " + p.amt).join(", ")}`));
  }
  if ((meta.subs || []).length) rows.push("\nSUBSCRIPTIONS: " + meta.subs.map((s: any) => `${s.name} ${s.amt} every ${s.cycle || 1} month(s), next ${s.next || "?"}${s.active === false ? " (stopped)" : ""}`).join("; "));
  if ((meta.budgets || []).length) rows.push("BUDGETS (monthly): " + meta.budgets.map((b: any) => `${String(b.key).slice(4)} ${b.amt}`).join(", "));
  rows.push("\nTRANSACTIONS, oldest first: date | type (exp spending, inc income, xfer transfer, adj adjustment) | amount | my share if split | category | subcategory | note | paid with | tags");
  const txRows = tx.map((x) => [x.d, x.t, r2(x.amt), x.split ? `${r2(x.split.mine)} (rest owed by ${x.split.person})` : "", plainCat(x.cat), x.sub || "", x.note || "",
    x.t === "xfer" ? `${x.from || "?"} -> ${x.to || "?"}` : x.pm === "later" ? `PayLater ${x.plp || "GrabPay Later"}${x.inst && x.inst.n > 1 ? " in " + x.inst.n + " instalments" : ""}` : x.acct || "", (x.tags || []).join("/")].join(" | "));
  // keep the newest rows when it's too much to send
  let used = out.join("\n").length + rows.join("\n").length, keepFrom = 0;
  for (let i = txRows.length - 1; i >= 0; i--) { used += txRows[i].length + 1; if (used > LIMIT) { keepFrom = i + 1; break; } }
  if (keepFrom > 0) rows.push(`(${keepFrom} older transactions before ${tx[keepFrom].d} are left out to fit; the totals above still include them)`);
  rows.push(...txRows.slice(keepFrom));
  return out.join("\n") + "\n" + rows.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // only a signed-in user of this project may spend the API key
  const auth = req.headers.get("Authorization") || "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: "Sign in first." }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  try {
    if (body.action === "review") {
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, 200) as Item[];
      const cats = (Array.isArray(body.cats) ? body.cats : []).slice(0, 100).map(String);
      if (!items.length) return json({ findings: [] });
      const prompt = `Allowed categories: ${JSON.stringify(cats)}\nEntries:\n${items.map((x) => JSON.stringify(x)).join("\n")}`;
      const out = await complete(REVIEW_SYSTEM, [{ role: "user", content: prompt }], true);
      const parsed = firstJson(out.text);
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
      const context = String(body.context || "").slice(0, 40000);
      const history = (Array.isArray(body.history) ? body.history : []).slice(-10)
        .filter((m: Turn) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m: Turn) => ({ role: m.role, content: m.content.slice(0, 2000) }));
      if (!question) return json({ error: "Ask a question." }, 400);
      const ledger = await fullLedger(sb);
      const messages: Turn[] = [
        { role: "user", content: `My finances. Amounts in SGD.\n\nCURRENT SNAPSHOT (live balances and recent months, from the app):\n${context}\n\nFULL LEDGER:\n${ledger}` },
        { role: "assistant", content: "Got it. What would you like to know?" },
        ...history,
        { role: "user", content: question },
      ];
      const out = await complete(ASK_SYSTEM, messages, false);
      return json({ answer: out.text.trim(), provider: provider(), model: out.model });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
