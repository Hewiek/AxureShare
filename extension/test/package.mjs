/* 用扩展自带的 lib/zip.js 打包分发压缩包。用法：node extension/test/package.mjs */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.join(here, "..");
const repoDir = path.join(extensionDir, "..");

vm.runInThisContext(fs.readFileSync(path.join(extensionDir, "lib", "zip.js"), "utf8"), { filename: "zip.js" });

const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
const runtime = [
  "manifest.json",
  "background.js",
  "config.js",
  "content.js",
  "content.css",
  "popup.html",
  "popup.css",
  "popup.js",
  "login.html",
  "login.css",
  "login.js",
];
for (const file of fs.readdirSync(path.join(extensionDir, "lib"))) runtime.push(`lib/${file}`);

const missing = runtime.filter((rel) => !fs.existsSync(path.join(extensionDir, rel)));
if (missing.length) {
  console.error("缺少文件：", missing.join(", "));
  process.exit(1);
}

const encoder = new TextEncoder();
const entries = runtime.map((rel) => ({
  name: rel,
  data: new Uint8Array(fs.readFileSync(path.join(extensionDir, rel))),
}));

const zip = await AXShare.zip.buildZip(entries);
const merged = new Uint8Array(zip.size);
let cursor = 0;
for (const chunk of zip.chunks) {
  merged.set(chunk, cursor);
  cursor += chunk.length;
}

const distDir = path.join(repoDir, "dist");
fs.mkdirSync(distDir, { recursive: true });
const target = path.join(distDir, `axureshare-upload-helper-${manifest.version}.zip`);
fs.writeFileSync(target, merged);

const raw = entries.reduce((sum, e) => sum + e.data.length, 0);
console.log(`打包 ${entries.length} 个文件：${target}`);
console.log(`原始 ${raw} B → 压缩包 ${zip.size} B（${Math.round((zip.size / raw) * 100)}%）`);
