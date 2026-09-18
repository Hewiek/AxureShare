/* 内容脚本侧：识别 Axure 预览页并收集资源种子 URL（实际抓取与打包在后台完成）。 */
(function (global) {
  "use strict";

  var REF_SELECTOR = [
    "script[src]", "link[href]", "img[src]", "img[data-src]", "source[src]", "source[data-src]",
    "iframe[src]", "frame[src]", "embed[src]", "object[data]", "video[src]", "audio[src]",
    "use[href]", "use[xlink\\:href]", "image[href]", "a[href]",
  ].join(",");

  function isAxureDocument(doc) {
    if (!doc) return false;
    if (doc.querySelector('script[src*="data/document.js"]')) return true;
    if (doc.getElementById("sitemapContainer") && doc.getElementById("mainFrame")) return true;
    var base = doc.getElementById("base");
    if (base && doc.querySelector('link[href*="styles/"], script[src*="scripts/"]')) return true;
    return false;
  }

  function detect(rootDoc) {
    if (isAxureDocument(rootDoc)) return true;
    var frames = rootDoc.querySelectorAll("iframe,frame");
    for (var i = 0; i < frames.length; i++) {
      try {
        if (isAxureDocument(frames[i].contentDocument)) return true;
      } catch (e) {
        /* 跨域 iframe 无权访问，忽略 */
      }
    }
    return false;
  }

  function toAbsolute(raw, baseUrl) {
    if (!raw) return "";
    var value = String(raw).trim();
    if (!value) return "";
    if (/^(data|blob|javascript|mailto|tel|about):/i.test(value)) return "";
    try {
      return new URL(value, baseUrl).href;
    } catch (e) {
      return "";
    }
  }

  function fromSrcset(srcset, baseUrl) {
    var out = [];
    String(srcset || "").split(",").forEach(function (part) {
      var url = toAbsolute(part.trim().split(/\s+/)[0], baseUrl);
      if (url) out.push(url);
    });
    return out;
  }

  function fromDocument(doc) {
    var out = [];
    var baseUrl = doc.baseURI || doc.URL;
    out.push(toAbsolute(doc.URL, baseUrl));
    var elements = doc.querySelectorAll(REF_SELECTOR);
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      ["src", "href", "data-src", "data"].forEach(function (attr) {
        var value = el.getAttribute(attr);
        var url = toAbsolute(value, baseUrl);
        if (url) out.push(url);
      });
      fromSrcset(el.getAttribute("srcset"), baseUrl).forEach(function (u) { out.push(u); });
      fromSrcset(el.getAttribute("data-srcset"), baseUrl).forEach(function (u) { out.push(u); });
    }
    var styles = doc.querySelectorAll("[style]");
    for (var s = 0; s < styles.length; s++) {
      var text = styles[s].getAttribute("style") || "";
      var re = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
      var match;
      while ((match = re.exec(text))) {
        var url2 = toAbsolute(match[1], baseUrl);
        if (url2) out.push(url2);
      }
    }
    try {
      var entries = global.performance.getEntriesByType("resource");
      for (var p = 0; p < entries.length; p++) {
        var u3 = toAbsolute(entries[p].name, baseUrl);
        if (u3) out.push(u3);
      }
    } catch (e) {
      /* performance 不可用时跳过 */
    }
    return out;
  }

  /* 顶层文档 + 可访问的同源 iframe */
  function collectSeedUrls(rootDoc) {
    var urls = fromDocument(rootDoc);
    var frames = rootDoc.querySelectorAll("iframe,frame");
    for (var i = 0; i < frames.length; i++) {
      var frameDoc = null;
      try {
        frameDoc = frames[i].contentDocument;
      } catch (e) {
        frameDoc = null;
      }
      if (!frameDoc || !frameDoc.URL) continue;
      fromDocument(frameDoc).forEach(function (u) { urls.push(u); });
      try {
        var inner = frameDoc.querySelectorAll("iframe,frame");
        for (var k = 0; k < inner.length; k++) {
          try {
            if (inner[k].contentDocument) fromDocument(inner[k].contentDocument).forEach(function (u2) { urls.push(u2); });
          } catch (e2) { /* 忽略 */ }
        }
      } catch (e3) { /* 忽略 */ }
    }
    return urls;
  }

  /* Axure 导出根目录：当前页面所在目录 */
  function exportRoot(docUrl) {
    try {
      var url = new URL(docUrl);
      var path = url.pathname.replace(/\\/g, "/");
      return url.origin + path.slice(0, path.lastIndexOf("/") + 1);
    } catch (e) {
      return "";
    }
  }

  function rootCandidates(docUrl) {
    var root = exportRoot(docUrl);
    if (!root) return [];
    var out = [root];
    var parts = root.replace(/\/$/, "").split("/");
    if (parts.length > 3) {
      parts.pop();
      out.push(parts.join("/").replace(/^(https?:\/\/)/, "$1") + "/");
    }
    return out;
  }

  function axureProbeUrls(root) {
    var probes = [];
    ["data/document.js", "index.html", "start.html"].forEach(function (rel) {
      probes.push(root + rel);
    });
    return probes;
  }

  global.AXShare = global.AXShare || {};
  global.AXShare.discover = {
    detect: detect,
    isAxureDocument: isAxureDocument,
    collectSeedUrls: collectSeedUrls,
    exportRoot: exportRoot,
    rootCandidates: rootCandidates,
    axureProbeUrls: axureProbeUrls,
    toAbsolute: toAbsolute,
  };
})(typeof self !== "undefined" ? self : globalThis);
