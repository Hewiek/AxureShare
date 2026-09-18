/* AxureShare 服务端 API 客户端。网络相关函数不依赖 chrome.*，便于在 Node 中复用测试。 */
(function (global) {
  "use strict";

  var encoder = new TextEncoder();

  function normalizeServer(url) {
    var value = String(url || "").trim();
    if (!value) return "";
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) value = "http://" + value;
    return value.replace(/\/+$/, "");
  }

  function authHeaders(token) {
    return { Authorization: "Bearer " + token };
  }

  async function request(server, path, options) {
    var opts = options || {};
    var init = { method: opts.method || "GET", headers: opts.headers || {}, redirect: "follow" };
    if (opts.body !== undefined) init.body = opts.body;
    if (opts.duplex) init.duplex = opts.duplex;
    if (opts.signal) init.signal = opts.signal;
    var response;
    try {
      response = await fetch(normalizeServer(server) + path, init);
    } catch (e) {
      var message = e && e.message ? e.message : String(e);
      if (/fetch failed|Failed to fetch|network|ERR_/i.test(message)) {
        throw new Error("无法连接服务器（" + message + "），请检查地址、网络与服务器是否在运行");
      }
      throw new Error(message);
    }
    var text = await response.text();
    var data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      var snippet = text.replace(/\s+/g, " ").slice(0, 120).trim();
      data = { message: "服务器返回了非 JSON 响应（HTTP " + response.status + "），请确认地址只填到站点根路径：" + snippet };
    }
    return { ok: response.ok, status: response.status, data: data };
  }

  async function login(server, username, password) {
    var res = await request(server, "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, password: password }),
    });
    if (!res.ok || !res.data || !res.data.token) {
      throw new Error((res.data && res.data.message) || "登录失败（HTTP " + res.status + "）");
    }
    return res.data.token;
  }

  async function listProjects(server, token) {
    var res = await request(server, "/api/projects", { headers: authHeaders(token) });
    if (!res.ok) {
      if (res.status === 401) throw new Error("API 密钥无效或已过期，请重新登录获取");
      throw new Error((res.data && res.data.message) || "获取项目列表失败（HTTP " + res.status + "）");
    }
    return (res.data && res.data.projects) || [];
  }

  async function profile(server, token) {
    var res = await request(server, "/api/profile", { headers: authHeaders(token) });
    if (!res.ok) {
      if (res.status === 401) throw new Error("未登录或 API 密钥已失效");
      throw new Error((res.data && res.data.message) || "获取账户信息失败（HTTP " + res.status + "）");
    }
    return res.data || {};
  }

  async function createProject(server, token, name) {
    var res = await request(server, "/api/projects", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders(token)),
      body: JSON.stringify({ name: name }),
    });
    if (!res.ok || !res.data || !res.data.id) {
      throw new Error((res.data && res.data.message) || "创建项目失败（HTTP " + res.status + "）");
    }
    return res.data;
  }

  async function getProgress(server, token, uploadId) {
    var res = await request(server, "/api/upload/progress?upload_id=" + encodeURIComponent(uploadId), {
      headers: authHeaders(token),
    });
    return res.data || { stage: "unknown", done: false };
  }

  function fieldChunk(boundary, name, value) {
    return encoder.encode(
      "--" + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' + value + "\r\n"
    );
  }

  function fileChunkHeader(boundary, name, filename) {
    return encoder.encode(
      '--' + boundary +
        '\r\nContent-Disposition: form-data; name="' + name + '"; filename="' + filename +
        '"\r\nContent-Type: application/zip\r\n\r\n'
    );
  }

  var CRLF = encoder.encode("\r\n");
  function tailChunk(boundary) {
    return encoder.encode("--" + boundary + "--\r\n");
  }

  function concatSize(chunks) {
    var size = 0;
    for (var i = 0; i < chunks.length; i++) size += chunks[i].length;
    return size;
  }

  function streamOf(chunks, onBytes) {
    var index = 0;
    var sent = 0;
    return new ReadableStream({
      pull: function (controller) {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        var chunk = chunks[index++];
        sent += chunk.length;
        if (onBytes) onBytes(sent);
        controller.enqueue(chunk);
      },
    });
  }

  /* opts: { server, token, name, zip: {chunks,size}, projectId, isPublic, accessPassword, resourceType, uploadId, onSend, signal } */
  async function upload(opts) {
    var zip = opts.zip;
    if (!zip || !zip.chunks || !zip.chunks.length) throw new Error("没有可上传的文件");

    var boundary = "----AxureShareHelper" + Math.random().toString(36).slice(2);
    var chunks = [];
    chunks.push(fieldChunk(boundary, "name", opts.name || "未命名原型"));
    if (opts.projectId !== undefined && opts.projectId !== null && opts.projectId !== "") {
      chunks.push(fieldChunk(boundary, "project_id", String(opts.projectId)));
    }
    chunks.push(fieldChunk(boundary, "is_public", opts.isPublic ? "true" : "false"));
    chunks.push(fieldChunk(boundary, "resource_type", opts.resourceType || "axure"));
    if (opts.accessPassword) chunks.push(fieldChunk(boundary, "access_password", opts.accessPassword));
    if (opts.uploadId) chunks.push(fieldChunk(boundary, "upload_id", opts.uploadId));

    var zipName = (opts.name || "prototype").replace(/[\\/:*?"<>|]/g, "_") + ".zip";
    chunks.push(fileChunkHeader(boundary, "zip_file", zipName));
    for (var i = 0; i < zip.chunks.length; i++) chunks.push(zip.chunks[i]);
    chunks.push(CRLF, tailChunk(boundary));

    var total = concatSize(chunks);
    var res = await request(opts.server, "/api/upload", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "multipart/form-data; boundary=" + boundary }, authHeaders(opts.token)),
      body: streamOf(chunks, opts.onSend ? function (sent) {
        opts.onSend(Math.min(sent, total), total);
      } : undefined),
      duplex: "half",
      signal: opts.signal,
    });
    if (!res.ok) {
      throw new Error((res.data && res.data.message) || "上传失败（HTTP " + res.status + "）");
    }
    return res.data || {};
  }

  global.AXShare = global.AXShare || {};
  global.AXShare.api = {
    normalizeServer: normalizeServer,
    request: request,
    login: login,
    listProjects: listProjects,
    createProject: createProject,
    profile: profile,
    getProgress: getProgress,
    upload: upload,
  };
})(typeof self !== "undefined" ? self : globalThis);
