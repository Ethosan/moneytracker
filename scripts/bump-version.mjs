/* Auto-bump version based on the commit message (conventional commits).
   Works for Vite apps (bumps package.json + define) and static apps (bumps VERSION + HTML meta).
   Usage:
     node scripts/bump-version.mjs "<commit message>"   — bump and print new version
     node scripts/bump-version.mjs --check "<message>"  — print bump type without writing
   Maps: feat!:/BREAKING CHANGE → MAJOR, feat: → MINOR, fix: → PATCH, other → PATCH
*/
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const pkgPath = resolve(rootDir, "package.json");
const versionPath = resolve(rootDir, "VERSION");

const args = process.argv.slice(2);
const checkOnly = args[0] === "--check";
const message = (checkOnly ? args[1] : args[0]) || "";

function bumpType(msg) {
  const head = msg.split("\n")[0].trim();
  if (/^\w+!:/i.test(head) || /BREAKING[ -]CHANGE/i.test(msg)) return "major";
  if (/^feat(\(.+\))?:/i.test(head)) return "minor";
  if (/^fix(\(.+\))?:/i.test(head)) return "patch";
  return "patch";
}

function bump(current, type) {
  const parts = current.split(".");
  while (parts.length < 3) parts.push("0");
  const [maj, min, pat] = parts.map(Number);
  if (type === "major") return `${maj + 1}.0.0`;
  if (type === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

// --- read current version ---
const usePkg = existsSync(pkgPath);
const current = usePkg
  ? JSON.parse(readFileSync(pkgPath, "utf8")).version || "0.0.0"
  : (existsSync(versionPath) ? readFileSync(versionPath, "utf8").trim() : "0.0.0");

const type = bumpType(message);
const next = bump(current, type);

if (checkOnly) { console.log(`${current} → ${next} (${type})`); process.exit(0); }
if (next === current) { console.log(`version already at ${next}`); process.exit(0); }

// --- write new version ---
if (usePkg) {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.version = next;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
} else {
  writeFileSync(versionPath, next + "\n");
}

// --- also update HTML meta tags: <meta name="app-version" content="X.Y.Z"> ---
function updateHtmlMeta(dir, ver) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === ".wrangler") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { updateHtmlMeta(full, ver); continue; }
    if (!entry.name.endsWith(".html")) continue;
    try {
      let html = readFileSync(full, "utf8");
      // Update existing meta tag
      if (html.includes('name="app-version"')) {
        html = html.replace(/<meta\s+name="app-version"\s+content="[^"]*"\s*\/?>/gi, `<meta name="app-version" content="${ver}">`);
      } else {
        // Insert after the last meta tag in <head>, before </head>
        html = html.replace(/(<\/head>)/i, `  <meta name="app-version" content="${ver}">\n$1`);
      }
      // Update any data-app-version attributes
      html = html.replace(/data-app-version="[^"]*"/gi, `data-app-version="${ver}"`);
      writeFileSync(full, html);
    } catch {}
  }
}
updateHtmlMeta(rootDir, next);

// --- stamp the app's own scripts and stylesheet with the version, and the service worker's cache name ---
// A new release is then a URL the browser has never cached, so it loads on the next open instead of
// after the 4-hour browser cache, and the changed sw.js reinstalls the worker, which shows the
// "Updated to the latest version" toast. The pre-commit hook stages index.html and sw.js.
function stampAssets(ver) {
  const indexPath = join(rootDir, "index.html"), swPath = join(rootDir, "sw.js");
  if (existsSync(indexPath)) {
    let html = readFileSync(indexPath, "utf8");
    html = html.replace(/\b(src|href)="((?:js\/|vendor\/|config\.js|app\.css)[^"?]*)(\?v=[^"]*)?"/g, (m, attr, path) => `${attr}="${path}?v=${ver}"`);
    writeFileSync(indexPath, html);
  }
  if (existsSync(swPath)) {
    const sw = readFileSync(swPath, "utf8").replace(/const CACHE = '[^']*';/, `const CACHE = 'ledger-${ver}';`);
    writeFileSync(swPath, sw);
  }
}
stampAssets(next);

console.log(`bumped ${type}: ${current} → ${next}`);
