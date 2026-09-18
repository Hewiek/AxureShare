/* 端到端验证：静态服务 fixture → 扩展 lib 抓取+打包 → Python 校验 ZIP → 上传 AxureShare → 比对落盘结果。
   用法：node extension/test/e2e.mjs [--no-server]
   可用环境变量：AXSHARE_SERVER / AXSHARE_USER / AXSHARE_PASSWORD */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, "fixtures");
const extensionDir = path.join(here, "..");
const repoDir = path.join(extensionDir, "..");
const py = process.platform === "win32" ? path.join(repoDir, ".venv", "Scripts", "python.exe") : "python3";
const withServer = !process.argv.includes("--no-server");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || "" });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

for (const lib of ["lib/zip.js", "lib/api.js", "lib/gather.js", "lib/discover.js", "config.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(extensionDir, lib), "utf8"), { filename: lib });
}
const AXShare = globalThis.AXShare;

function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
      const file = path.join(fixtureDir, rel);
      if (!rel || !file.startsWith(path.resolve(fixtureDir)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, process.env.E2E_HOST || "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function walk(dir, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

const { server, port } = await startStaticServer();
const root = `http://${process.env.E2E_HOST || "127.0.0.1"}:${port}/`;
console.log(`fixture 静态服务: ${root}`);

const resolved = await AXShare.gather.resolveRoot([root]);
check("resolveRoot 定位到导出根目录", resolved.root === root, `${resolved.root} (marker=${resolved.marker})`);

const seeds = [root + "index.html", root + "start.html", root + "data/document.js"];
const collectLog = [];
const collected = await AXShare.gather.collectFiles({
  root: resolved.root,
  seeds,
  onProgress: (found, queued, bytes) => collectLog.push(`${found}/${found + queued} ${Math.round(bytes / 1024)}KB`),
});

const names = collected.files.map((f) => f.name).sort();
const allFixture = walk(fixtureDir);
const expected = allFixture.filter((n) => n !== "images/孤立文件.png");

check("抓取数量正确", collected.files.length === expected.length, `抓到 ${collected.files.length}，期望 ${expected.length}`);
check("未引用文件不纳入（BFS 边界）", !names.includes("images/孤立文件.png"));
check("多目录资源齐全", ["data/document.js", "data/styles.css", "plugins/sitemap/sitemap.js", "scripts/axurerp_pagescript.js", "styles/page-one.css"].every((n) => names.includes(n)), names.join(", "));
check("中文文件名保留", names.includes("页面一.html") && names.includes("images/图标.png"));
check("CSS url() 跨目录引用被抓到", names.includes("images/banner.png") && names.includes("images/未引用的图片.png"));
check("抓取无意外失败", collected.skipped.every((s) => /HTTP 404/.test(s.reason)), JSON.stringify(collected.skipped));

const entries = [];
for (const file of collected.files) entries.push({ name: file.name, data: new Uint8Array(await file.blob.arrayBuffer()) });

const zip = await AXShare.zip.buildZip(entries);
const zipPath = path.join(os.tmpdir(), "axureshare-e2e.zip");
const merged = new Uint8Array(zip.size);
let cursor = 0;
for (const chunk of zip.chunks) {
  merged.set(chunk, cursor);
  cursor += chunk.length;
}
fs.writeFileSync(zipPath, merged);

function runPy(args) {
  try {
    return execFileSync(py, args, { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  } catch (e) {
    return `${e.stdout || ""}${e.stderr || ""}`.trim() || String(e.message);
  }
}

const pyValidate = fs.readFileSync(path.join(here, "validate_zip.py"), "utf8");
const validateOut = runPy(["-c", pyValidate, zipPath, fixtureDir]);
check("Python zipfile 可完整解压且内容一致", validateOut.includes("ZIP_OK"), validateOut.trim().split("\n")[0]);
check("文本资源走 deflate、图片回退 store", validateOut.includes("COMP_OK"), validateOut.trim().split("\n")[1] || "");

if (withServer) {
  const api = process.env.AXSHARE_SERVER || "http://127.0.0.1:7855";
  const user = process.env.AXSHARE_USER || "admin";
  const password = process.env.AXSHARE_PASSWORD || "123456";

  const issued = await AXShare.config.fetchServer(api);
  check("/api/extension/config 下发服务器地址", /^https?:\/\/[^/]+$/.test(issued), issued);
  check("打包内置引导地址非空", !!AXShare.config.BOOTSTRAP_SERVER, AXShare.config.BOOTSTRAP_SERVER);

  const token = await AXShare.api.login(api, user, password);
  check("/api/login 换取 token", !!token, token ? token.slice(0, 8) + "…" : "");

  const account = await AXShare.api.profile(api, token);
  check("/api/profile 返回登录身份", account.username === user && typeof account.can_create_project === "boolean", JSON.stringify(account));

  const projectName = "扩展端到端项目";
  const created = await AXShare.api.createProject(api, token, projectName);
  const again = await AXShare.api.createProject(api, token, projectName);
  check("POST /api/projects 返回可用项目", !!created.id && typeof created.created === "boolean", JSON.stringify(created));
  check("同名项目复用而非报错", again.id === created.id && again.created === false, JSON.stringify(again));

  let rejected = null;
  try {
    await AXShare.api.createProject(api, token, "   ");
  } catch (e) {
    rejected = e.message;
  }
  check("空项目名被服务端拒绝", /不能为空/.test(rejected || ""), rejected || "");

  let projects = await AXShare.api.listProjects(api, token);
  const picked = projects.filter((p) => p.id === created.id)[0];
  check("/api/projects 附带项目内原型清单", !!picked && Array.isArray(picked.prototypes), JSON.stringify(picked && picked.prototypes));

  const name = "扩展端到端验证";
  const uploadId = "e2e-" + Date.now();
  let sentBytes = 0;
  let totalBody = 0;
  const started = Date.now();
  const result = await AXShare.api.upload({
    server: api,
    token,
    name,
    projectId: String(created.id),
    isPublic: true,
    uploadId,
    zip,
    onSend: (sent, total) => {
      sentBytes = sent;
      totalBody = total;
    },
  });
  check("/api/upload 返回 short_id", !!(result && result.short_id), JSON.stringify(result));
  check("上传进度覆盖整个请求体", sentBytes === totalBody && sentBytes > zip.size, `发送 ${sentBytes}B / 请求体 ${totalBody}B，ZIP ${zip.size}B，用时 ${Date.now() - started}ms`);

  let progress = null;
  for (let i = 0; i < 40; i++) {
    progress = await AXShare.api.getProgress(api, token, uploadId);
    if (progress && progress.done) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  check("服务端进度到 done", progress && progress.stage === "done", JSON.stringify(progress));

  const preview = await fetch(`${api}/v/${result.short_id}/index.html`);
  const previewText = await preview.text();
  check("预览页可访问且内容来自上传包", preview.status === 200 && previewText.includes("扩展验证原型"), `HTTP ${preview.status}`);

  const entry = await fetch(`${api}/v/${result.short_id}/`);
  check("入口自动跳转 index.html", entry.status === 200 && /\/index\.html/.test(entry.url), `HTTP ${entry.status} → ${entry.url}`);

  const diffOut = runPy(["-c", pyValidate, zipPath, fixtureDir, api, String(result.id)]);
  check("服务端落盘文件与打包一致", diffOut.includes("STORE_OK"), diffOut.trim().split("\n").pop());

  projects = await AXShare.api.listProjects(api, token);
  const listed = projects.filter((p) => p.id === created.id)[0];
  const listedProto = (listed.prototypes || []).filter((p) => p.name === name)[0];
  check("原型出现在所属项目清单中", !!listedProto && listedProto.is_public === true, JSON.stringify(listed && listed.prototypes));

  const updateId = "e2e-up-" + Date.now();
  const updated = await AXShare.api.upload({
    server: api,
    token,
    name,
    projectId: String(created.id),
    isPublic: true,
    uploadId: updateId,
    zip,
  });
  check("同名原型上传为替换更新（同一 id）", updated.id === result.id && /更新成功/.test(updated.message || ""), JSON.stringify(updated));
}

server.closeAllConnections();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n合计 ${results.length} 项，失败 ${failed.length} 项`);
process.exit(failed.length ? 1 : 0);
