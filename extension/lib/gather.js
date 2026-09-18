/* 后台侧：从种子 URL 广度遍历，抓全 Axure 导出资源。不依赖 chrome.*，可在 Node 复用。 */
(function (global) {
  "use strict";

  var TEXT_EXT = /\.(html?|js|css|svg|xml|json)(\?|#|$)/i;
  var ASSET_RE = /["'()]([^"'()\s]+?\.(?:html?|js|css|png|jpe?g|gif|svg|webp|bmp|ico|woff2?|ttf|eot|mp4|webm|pdf|json|xml|txt|rtf))["')]/gi;
  var ATTR_RE = /(?:src|href|data-src|poster|data)\s*=\s*["']([^"']+)["']/gi;
  var URL_FN_RE = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  var SRCSET_RE = /srcset\s*=\s*["']([^"']+)["']/gi;

  function underRoot(url, root) {
    try {
      var u = new URL(url);
      var r = new URL(root);
      if (u.origin !== r.origin) return false;
      var rootPath = r.pathname.endsWith("/") ? r.pathname : r.pathname.slice(0, r.pathname.lastIndexOf("/") + 1);
      return u.pathname.startsWith(rootPath);
    } catch (e) {
      return false;
    }
  }

  function relativeName(url, root) {
    var u = new URL(url);
    var r = new URL(root);
    var rootPath = r.pathname.endsWith("/") ? r.pathname : r.pathname.slice(0, r.pathname.lastIndexOf("/") + 1);
    var rel = decodeURIComponent(u.pathname.slice(rootPath.length)).replace(/^\/+/, "");
    var search = u.search || "";
    return { name: rel, key: rel + search };
  }

  function isTextual(url) {
    return TEXT_EXT.test(String(url).split("?")[0]);
  }

  function extractRefs(text, baseUrl) {
    var out = [];
    var patterns = [ATTR_RE, URL_FN_RE, ASSET_RE, SRCSET_RE];
    for (var p = 0; p < patterns.length; p++) {
      var re = new RegExp(patterns[p].source, patterns[p].flags);
      var match;
      while ((match = re.exec(text))) {
        var value = match[1];
        var parts = SRCSET_RE === patterns[p] ? value.split(",").map(function (x) { return x.trim().split(/\s+/)[0]; }) : [value];
        for (var i = 0; i < parts.length; i++) {
          var candidate = (parts[i] || "").trim();
          if (!candidate || /^(data|blob|javascript|mailto|tel|about):/i.test(candidate)) continue;
          if (/^\/\//.test(candidate)) candidate = new URL(baseUrl).protocol + candidate;
          try {
            out.push(new URL(candidate, baseUrl).href);
          } catch (e) {
            /* 非法 URL 忽略 */
          }
        }
      }
    }
    return out;
  }

  async function fetchResource(url, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 15000);
    try {
      var response = await fetch(url, { credentials: "omit", signal: controller.signal, cache: "no-store" });
      if (!response.ok) return { ok: false, status: response.status };
      var blob = await response.blob();
      if (!isTextual(url)) return { ok: true, blob: blob };
      var text = await new Response(blob).text();
      return { ok: true, blob: blob, text: text };
    } catch (e) {
      return { ok: false, status: 0, error: e && e.name === "AbortError" ? "超时" : String((e && e.message) || e) };
    } finally {
      clearTimeout(timer);
    }
  }

  /* opts: { root, seeds, maxFiles, maxBytes, concurrency, onProgress(found, queued, bytes) } */
  async function collectFiles(opts) {
    var root = opts.root;
    var maxFiles = opts.maxFiles || 4000;
    var maxBytes = opts.maxBytes || 800 * 1024 * 1024;
    var concurrency = opts.concurrency || 8;

    var queue = [];
    var seen = Object.create(null);
    var files = Object.create(null);
    var skipped = [];
    var totalBytes = 0;
    var depth = Object.create(null);

    function enqueue(url, fromDepth) {
      if (!url || !underRoot(url, root)) return;
      var clean = url.split("#")[0];
      if (!clean || seen[clean]) return;
      seen[clean] = true;
      depth[clean] = fromDepth;
      queue.push({ url: clean, d: fromDepth });
    }

    (opts.seeds || []).forEach(function (u) { enqueue(u, 1); });
    ["index.html", "start.html", "data/document.js"].forEach(function (rel) { enqueue(root + rel, 1); });

    while (queue.length) {
      var batch = queue.splice(0, concurrency);
      var results = await Promise.all(batch.map(function (item) {
        return fetchResource(item.url).then(function (res) { return { item: item, res: res }; });
      }));

      for (var i = 0; i < results.length; i++) {
        var item = results[i].item;
        var res = results[i].res;
        if (!res.ok) {
          skipped.push({ url: item.url, reason: res.error || ("HTTP " + res.status) });
          continue;
        }
        var info = relativeName(item.url, root);
        if (!info.name) continue;
        if (!files[info.key]) {
          if (Object.keys(files).length >= maxFiles) {
            skipped.push({ url: item.url, reason: "超过文件数上限" });
            continue;
          }
          if (totalBytes + res.blob.size > maxBytes) {
            skipped.push({ url: item.url, reason: "超过体积上限" });
            continue;
          }
          files[info.key] = { name: info.name, blob: res.blob, url: item.url };
          totalBytes += res.blob.size;
        }
        if (res.text && item.d < (opts.maxDepth || 5)) {
          /* Axure 的 document.js / 播放器脚本里的路径是导出根目录相对路径，
             而 HTML 与 CSS 里的才是文件自身相对路径。 */
          var refBase = /\.js(\?|#|$)/i.test(item.url) ? root : item.url;
          extractRefs(res.text, refBase).forEach(function (ref) { enqueue(ref, item.d + 1); });
        }
      }
      if (opts.onProgress) opts.onProgress(Object.keys(files).length, queue.length, totalBytes);
    }

    var list = Object.keys(files).map(function (k) { return files[k]; });
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return { files: list, skipped: skipped, totalBytes: totalBytes, truncated: skipped.length > 0 };
  }

  /* 探测最可能的导出根目录：优先含 data/document.js 的目录，其次含 index.html 的目录。 */
  async function resolveRoot(candidates) {
    var list = (candidates || []).filter(function (c) { return !!c; });
    for (var i = 0; i < list.length; i++) {
      var probe = await fetchResource(list[i] + "data/document.js");
      if (probe.ok) return { root: list[i], marker: "data/document.js" };
    }
    for (var j = 0; j < list.length; j++) {
      var probe2 = await fetchResource(list[j] + "index.html");
      if (probe2.ok) return { root: list[j], marker: "index.html" };
    }
    return { root: list[0] || "", marker: "" };
  }

  global.AXShare = global.AXShare || {};
  global.AXShare.gather = {
    collectFiles: collectFiles,
    resolveRoot: resolveRoot,
    extractRefs: extractRefs,
    underRoot: underRoot,
    relativeName: relativeName,
    fetchResource: fetchResource,
  };
})(typeof self !== "undefined" ? self : globalThis);
