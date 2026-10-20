// Bundle the app into self-contained single files (no external scripts or styles besides Google Fonts).
//
//   node tools/build.mjs
//
// dist/throughline.html  full standalone document: open from disk, email it, host it anywhere.
// dist/artifact.html     the same page without the <html>/<head>/<body> skeleton, for publishing
//                        as a claude.ai Artifact (the platform supplies the skeleton).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(repo, p), "utf8");
const html = read("index.html");

const inlineCss = (block) =>
  block.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => `<style>\n${read(href)}\n</style>`);

const inlineJs = (block) =>
  block.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => {
    const p = path.join(repo, src);
    if (!fs.existsSync(p)) {
      console.warn("skip missing script:", src);
      return "";
    }
    const code = fs.readFileSync(p, "utf8").replace(/<\/script/gi, "<\\/script");
    return `<script>/* ${src} */\n${code}\n</script>`;
  });

let out = html
  .replace(/<!-- build:css -->([\s\S]*?)<!-- \/build:css -->/, (_, b) => inlineCss(b.trim()))
  .replace(/<!-- build:js -->([\s\S]*?)<!-- \/build:js -->/, (_, b) => inlineJs(b.trim()));

fs.mkdirSync(path.join(repo, "dist"), { recursive: true });
fs.writeFileSync(path.join(repo, "dist/throughline.html"), out);

// Artifact variant: drop the document skeleton and the metas the platform provides.
const head = out.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset="utf-8">\s*/i, "")
  .replace(/<meta name="viewport"[^>]*>\s*/i, "")
  .trim();
const body = out.match(/<body>([\s\S]*?)<\/body>/)[1].trim();
fs.writeFileSync(path.join(repo, "dist/artifact.html"), head + "\n" + body + "\n");

const kb = (f) => (fs.statSync(path.join(repo, f)).size / 1024).toFixed(0) + " KB";
console.log("dist/throughline.html", kb("dist/throughline.html"));
console.log("dist/artifact.html   ", kb("dist/artifact.html"));
