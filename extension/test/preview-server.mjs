/* 本地静态服务：在普通标签页里预览扩展 UI（假数据，不上传）。用法：node extension/test/preview-server.mjs [port] */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || 7899);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "test/ui-preview.html";
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
});

/* 本机 127.0.0.1 被代理软件劫持时，可用局域网地址访问预览页。 */
const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
const displayHost = process.env.PREVIEW_DISPLAY_HOST || lanIp || "127.0.0.1";

server.listen(port, "0.0.0.0", () => {
  const base = `http://${displayHost}:${port}`;
  console.log(`扩展 UI 预览（假数据）：\n  页面面板   ${base}/test/ui-preview.html\n  扩展弹窗   ${base}/test/host-preview.html?page=popup\n  登录窗口   ${base}/test/host-preview.html?page=login`);
});
