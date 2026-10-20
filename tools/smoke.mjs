// Smoke test: open each route in headless Chromium, fail on console errors / page errors /
// horizontal overflow, and save screenshots.
//
//   node tools/smoke.mjs                 # all registered routes, desktop light
//   node tools/smoke.mjs dashboard roi   # just these routes
//   node tools/smoke.mjs --all-views     # also phone width (400px) and dark theme
//   node tools/smoke.mjs --file dist/throughline.html   # test the bundled single file
//
// Screenshots go to tools/.shots/<route>-<view>.png (git-ignored).
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require("/opt/node22/lib/node_modules/playwright"); }

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const args = process.argv.slice(2);
const allViews = args.includes("--all-views");
const fileIdx = args.indexOf("--file");
const target = fileIdx >= 0 ? path.resolve(repo, args[fileIdx + 1]) : path.join(repo, "index.html");
const routesArg = args.filter((a, i) => !a.startsWith("--") && (fileIdx < 0 || i !== fileIdx + 1));
const shots = path.join(here, ".shots");
fs.mkdirSync(shots, { recursive: true });

const launchOpts = { headless: true };
if (fs.existsSync("/opt/pw-browsers/chromium")) {
  // let playwright find its bundled build; executablePath only if a version mismatch bites
}
const browser = await pw.chromium.launch(launchOpts).catch(async () => pw.chromium.launch({ headless: true, executablePath: "/opt/pw-browsers/chromium" }));

const views = [{ name: "desktop", width: 1440, height: 1000, dark: false }];
if (allViews) {
  views.push({ name: "phone", width: 400, height: 860, dark: false });
  views.push({ name: "dark", width: 1440, height: 1000, dark: true });
}

const url = pathToFileURL(target).href;
let failures = 0;

// discover routes from the app if none given
let routes = routesArg;
if (!routes.length) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(300);
  routes = await page.evaluate(() => (window.OPS && OPS.modules ? OPS.modules().map((m) => m.id) : []));
  await ctx.close();
}

for (const v of views) {
  for (const r of routes) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, colorScheme: v.dark ? "dark" : "light" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error" && !/fonts\.(googleapis|gstatic)/.test(m.text()) && !/ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|TUNNEL|PROXY|CONNECTION)/.test(m.text())) errors.push("console: " + m.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await page.goto(url + "#" + r, { waitUntil: "load" });
    await page.waitForTimeout(900);
    const info = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      title: document.title,
      moduleError: !!document.querySelector("#module-root [data-module-error]"),
      empty: (document.getElementById("module-root") || { innerText: "" }).innerText.trim().length < 40,
      registered: window.OPS && OPS.modules ? OPS.modules().some((m) => m.id === location.hash.slice(1)) : false,
    }));
    if (!info.registered) errors.push("route not registered (module file missing or failed to load)");
    if (info.overflow > 1) errors.push(`horizontal overflow ${info.overflow}px`);
    if (info.moduleError) errors.push("module render threw (see error callout)");
    if (info.empty) errors.push("module rendered almost nothing");
    await page.screenshot({ path: path.join(shots, `${r}-${v.name}.png`), fullPage: true });
    const status = errors.length ? "FAIL" : "ok  ";
    if (errors.length) failures++;
    console.log(`${status} ${v.name.padEnd(7)} #${r}${errors.length ? "\n      " + errors.join("\n      ") : ""}`);
    await ctx.close();
  }
}
await browser.close();
console.log(failures ? `\n${failures} failing view(s)` : "\nall clean");
process.exit(failures ? 1 : 0);
