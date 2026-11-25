// Every script index.html loads must parse. One missing comma in a file no other test reads (js/whatsnew.js
// in 1.9.1) stops the app from starting at all, and no money test would notice.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const html = fs.readFileSync(new URL("index.html", root), "utf8");
const local = [...html.matchAll(/<script[^>]*\ssrc="([^"?#]+)/g)].map((m) => m[1].replace(/^\//, "")).filter((s) => !/^https?:/.test(s));

test("index.html loads its own scripts, and each one parses", () => {
  assert.ok(local.includes("js/app.js") && local.includes("js/whatsnew.js"), "found the app's scripts: " + local.join(", "));
  for (const src of local.concat("sw.js")) {
    const file = new URL(src, root);
    if (!fs.existsSync(file)) continue; // served by another project (the shared feedback widget)
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(file, "utf8"), { filename: src }), src);
  }
});
