// Checks for the 2026-11-26 audit fixes: no secrets in the repo, the SQL hardening in both the
// migration and schema.sql, Turnstile allowed by the CSP, and the plain-words sweep.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, root), "utf8");

test("no tracked file holds a secret key, and the shipped key is the anon one", () => {
  const files = execSync("git ls-files", { cwd: root, encoding: "utf8" }).split("\n").filter((f) =>
    /\.(js|mjs|cjs|ts|html|json|md|sql|toml|yml|yaml|webmanifest)$/.test(f) && !f.startsWith("vendor/") && !f.startsWith("tests/"));
  const bad = [];
  for (const f of files) {
    const t = read(f);
    if (/sk-[A-Za-z0-9]{20,}|sk-ant-/.test(t)) bad.push(f + " (api key)");
    if (/service_role/.test(t) && !/^supabase\/|\.md$/.test(f)) bad.push(f + " (service_role)");
  }
  assert.deepEqual(bad, []);
  const jwt = read("config.js").match(/eyJ[\w-]+\.([\w-]+)\.[\w-]+/);
  assert.ok(jwt, "config.js should carry the anon key");
  const payload = JSON.parse(Buffer.from(jwt[1], "base64url").toString());
  assert.equal(payload.role, "anon");
});

for (const f of ["supabase/migrations/20261126000000_audit_hardening.sql", "supabase/schema.sql"]) {
  test(`${f} has the AI clamp, the size and row caps, and a locked-down delete_my_account`, () => {
    const s = read(f);
    assert.match(s, /all_users_day\s*:=\s*least\(coalesce\(all_users_day,\s*0\),\s*300\)/);
    assert.match(s, /ledger_docs_body_size/);
    assert.match(s, /pg_column_size\(body\)\s*<\s*2000000/);
    assert.match(s, /ledger_docs_row_cap/);
    assert.match(s, /function public\.delete_my_account\(\)/i);
    assert.match(s, /security definer/i);
    assert.match(s, /revoke all on function public\.delete_my_account\(\) from public, anon/i);
    assert.match(s, /grant execute on function public\.delete_my_account\(\) to authenticated/i);
  });
}

test("the CSP lets Turnstile load, the service worker leaves it alone, and the key stays empty until set up", () => {
  const h = read("_headers");
  for (const line of h.split("\n").filter((l) => /^s*Content-Security-Policy[-w]*:/.test(l))) {
    assert.match(line, /script-src[^;]*challenges\.cloudflare\.com/);
    assert.match(line, /frame-src[^;]*challenges\.cloudflare\.com/);
  }
  assert.match(read("sw.js"), /challenges\.cloudflare\.com/);
  assert.match(read("config.js"), /turnstileSiteKey:\s*''/);
});

test("people-facing copy has no Supabase or config.js talk outside the sync details", () => {
  const app = read("js/app.js");
  for (const bad of ["sign in with your Supabase account", "Add your Supabase keys", "Loading your ledger", "stored in your Supabase project"]) {
    assert.ok(!app.includes(bad), bad);
  }
  assert.match(app, /role="alert"/);
});
