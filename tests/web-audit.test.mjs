// Static checks for the 2026-11 audit fixes: the head of each page, the headers file, the CSP
// against the inline script that used to be blocked, the single set of money tokens, and the
// sign-in screen's h1.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const title = (h) => (h.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
const desc = (h) => (h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";

test("each page has a descriptive title and a meta description", () => {
  for (const f of ["index.html", "privacy.html", "terms.html"]) {
    const h = read(f);
    assert.ok(title(h).length >= 40 && title(h).length <= 65, `${f} title is ${title(h).length} chars`);
    assert.ok(desc(h).length >= 70 && desc(h).length <= 160, `${f} description is ${desc(h).length} chars`);
  }
});

test("index.html has no inline script (the CSP blocks it) and the version stamp is drawn by CSS", () => {
  const h = read("index.html");
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(h), "an inline <script> would be blocked by script-src 'self'");
  assert.match(h, /class="app-version" data-app-version="[\d.]+"/);
  assert.match(read("app.css"), /\.app-version::before\{content:"v" attr\(data-app-version\)\}/);
  assert.ok(!/color:#999|opacity:0?\.5/.test(h.match(/<span class="app-version"[^>]*>/)[0]));
});

test("_headers carries HSTS, nosniff, Referrer-Policy, Permissions-Policy and a Report-Only CSP", () => {
  const h = read("_headers");
  assert.match(h, /Strict-Transport-Security: max-age=31536000; includeSubDomains/);
  assert.match(h, /X-Content-Type-Options: nosniff/);
  assert.match(h, /Referrer-Policy: /);
  assert.match(h, /Permissions-Policy: .*camera=\(\)/);
  const enforced = h.match(/^\s*Content-Security-Policy: (.*)$/m)[1];
  const report = h.match(/^\s*Content-Security-Policy-Report-Only: (.*)$/m)[1];
  assert.match(enforced, /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(enforced));
  assert.ok(/style-src/.test(report) && !/style-src[^;]*unsafe-inline/.test(report));
});

test("the money tokens (--loss, --gain, --rose) are defined once per theme in app.css", () => {
  const css = read("app.css");
  for (const t of ["--loss", "--gain", "--rose"]) {
    const n = (css.match(new RegExp("[;{ ]" + t + ":", "g")) || []).length;
    assert.equal(n, 3, `${t} should be set in the light block, the system-dark block and the manual dark block only`);
  }
});

test("the sign-in screen has one h1 and no inline styles", () => {
  const js = read("js/app.js");
  const login = js.slice(js.indexOf("function renderLogin"), js.indexOf("function wireLogin"));
  assert.equal((login.match(/<h1/g) || []).length, 1);
  assert.ok(!/style=/.test(login));
});

test("the sign-in column is capped at 420px on every width", () => {
  assert.match(read("app.css"), /main\.login\{display:block;max-width:420px;margin:0 auto/);
});
