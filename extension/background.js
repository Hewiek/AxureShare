/* 后台协调：抓取 → 打包 → 上传 → 轮询服务端解压进度。所有网络请求在此发起，不受页面 CSP 限制。 */
"use strict";

importScripts("lib/zip.js", "lib/api.js", "config.js", "lib/gather.js");

var CONFIG_TTL = 6 * 60 * 60 * 1000;

var DEFAULTS = {
  server: "",
  token: "",
  userName: "",
  role: "",
  loginStamp: 0,
  projectId: "",
  projectName: "",
  prototypeName: "",
  isPublic: false,
  alwaysShow: false,
  lastUploadUrl: "",
  serverManual: false,
  configStamp: 0,
};

async function loadSettings() {
  var stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  var settings = {};
  Object.keys(DEFAULTS).forEach(function (key) {
    settings[key] = stored[key] === undefined ? DEFAULTS[key] : stored[key];
  });
  settings.server = AXShare.api.normalizeServer(settings.server || AXShare.config.BOOTSTRAP_SERVER);
  settings.loggedIn = !!(settings.server && settings.token);
  return settings;
}

/* 服务器地址以后台下发为准；用户手动改过地址（serverManual）时不再覆盖。 */
async function refreshServerConfig(force) {
  var settings = await loadSettings();
  if (settings.serverManual || (!force && Date.now() - (settings.configStamp || 0) < CONFIG_TTL)) return settings;
  try {
    var server = await AXShare.config.fetchServer(settings.server);
    if (server !== settings.server) await chrome.storage.local.set({ server: server });
  } catch (e) {
    /* 后台不可达时沿用本机已知的地址 */
  }
  await chrome.storage.local.set({ configStamp: Date.now() });
  return loadSettings();
}

async function saveSettings(patch) {
  var allowed = {};
  Object.keys(DEFAULTS).forEach(function (key) {
    if (patch[key] !== undefined) allowed[key] = patch[key];
  });
  if (allowed.server !== undefined) allowed.server = AXShare.api.normalizeServer(allowed.server);
  await chrome.storage.local.set(allowed);
  return loadSettings();
}

function fail(message) {
  return { ok: false, message: message && message.message ? message.message : String(message) };
}

/* job: 通过 port 推送进度 */
async function runJob(spec, port) {
  var settings = await loadSettings();
  var server = AXShare.api.normalizeServer(spec.server || settings.server);
  var token = spec.token || settings.token;
  if (!server) throw new Error("未获取到服务器地址，请确认后台服务配置中的「站点访问地址」");
  if (!token) throw new Error("尚未登录，请点击「登录」按钮登录后再上传");

  var send = function (payload) {
    try {
      port.postMessage(payload);
    } catch (e) {
      /* 面板可能已被关闭 */
    }
  };

  send({ stage: "collect", text: "正在定位导出根目录…" });
  var resolved = await AXShare.gather.resolveRoot(spec.roots);
  if (!resolved.root) throw new Error("无法定位 Axure 导出目录");

  send({ stage: "collect", text: "正在收集原型资源…", root: resolved.root });
  var collected = await AXShare.gather.collectFiles({
    root: resolved.root,
    seeds: spec.seeds,
    onProgress: function (found, queued, bytes) {
      send({ stage: "collect", text: "收集资源中", found: found, queued: queued, bytes: bytes });
    },
  });

  if (!collected.files.length) {
    throw new Error("没有抓到任何文件，可能是本地 file:// 预览；请在弹窗里改用「选择文件夹并上传」");
  }

  var entries = [];
  send({ stage: "pack", text: "正在压缩打包…", total: collected.files.length });
  for (var i = 0; i < collected.files.length; i++) {
    var bytes = new Uint8Array(await collected.files[i].blob.arrayBuffer());
    entries.push({ name: collected.files[i].name, data: bytes });
  }

  var zip = await AXShare.zip.buildZip(entries, function (done, total) {
    if (done % 20 === 0 || done === total) send({ stage: "pack", text: "压缩打包中", done: done, total: total });
  });

  var name = (spec.name || "").trim() || deriveName(resolved.root);
  var projectId = spec.projectId === undefined ? settings.projectId : spec.projectId;
  if (spec.newProjectName) {
    send({ stage: "project", text: "正在创建项目「" + spec.newProjectName + "」…" });
    var created = await AXShare.api.createProject(server, token, String(spec.newProjectName).trim());
    projectId = String(created.id);
    await saveSettings({ projectId: projectId, projectName: created.name });
  }
  var uploadId = "ext-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);

  var polling = true;
  var poll = (async function () {
    while (polling) {
      try {
        var progress = await AXShare.api.getProgress(server, token, uploadId);
        if (progress && progress.stage && progress.stage !== "unknown") {
          send({
            stage: "extract",
            text: "服务端解压 " + progress.stage,
            loaded: progress.loaded,
            total: progress.total,
            error: progress.error,
          });
        }
      } catch (e) {
        /* 轮询失败不影响上传本身 */
      }
      await new Promise(function (r) { setTimeout(r, 500); });
    }
  })();

  send({ stage: "upload", text: "开始上传…", total: zip.size });
  var result;
  try {
    result = await AXShare.api.upload({
      server: server,
      token: token,
      name: name,
      projectId: projectId,
      isPublic: spec.isPublic === undefined ? settings.isPublic : !!spec.isPublic,
      accessPassword: spec.accessPassword || "",
      uploadId: uploadId,
      zip: zip,
      onSend: function (sent, total) {
        send({ stage: "upload", text: "上传中", sent: sent, total: total });
      },
    });
  } finally {
    polling = false;
  }

  var shortId = result && result.short_id;
  var url = shortId ? server + "/v/" + shortId + "/" : "";
  await saveSettings({ lastUploadUrl: url, prototypeName: name });
  send({
    stage: "done",
    text: (result && result.message) || "上传完成",
    message: (result && result.message) || "上传完成",
    url: url,
    prototypeId: result && result.id,
    files: collected.files.length,
    skipped: collected.skipped.length,
    bytes: zip.size,
    projectId: projectId,
  });
  return { ok: true, url: url, message: result && result.message };
}

function deriveName(root) {
  var parts = String(root).replace(/\/+$/, "").split("/");
  return decodeURIComponent(parts[parts.length - 1] || "未命名原型");
}

async function openLoginWindow() {
  var win = await chrome.windows.create({
    url: chrome.runtime.getURL("login.html"),
    type: "popup",
    width: 400,
    height: 560,
    focused: true,
  });
  return { ok: true, windowId: win && win.id };
}

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== "job") return;
  port.onMessage.addListener(function (message) {
    if (!message || message.type !== "start") return;
    runJob(message.spec || {}, port).catch(function (error) {
      try {
        port.postMessage({ stage: "error", text: fail(error).message });
      } catch (e) {
        /* port 已断开 */
      }
    });
  });
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || !message.type) return false;

  if (message.type === "settings:get") {
    refreshServerConfig(false).then(sendResponse, function (e) { sendResponse(fail(e)); });
    return true;
  }
  if (message.type === "config:refresh") {
    refreshServerConfig(true).then(
      function (settings) { sendResponse({ ok: true, settings: settings }); },
      function (e) { sendResponse(fail(e)); }
    );
    return true;
  }
  if (message.type === "settings:set") {
    saveSettings(message.patch || {}).then(sendResponse, function (e) { sendResponse(fail(e)); });
    return true;
  }
  if (message.type === "login:open") {
    openLoginWindow().then(sendResponse, function (e) { sendResponse(fail(e)); });
    return true;
  }
  if (message.type === "logout") {
    saveSettings({ token: "", userName: "", role: "", loginStamp: Date.now(), projectId: "", projectName: "" })
      .then(function (settings) { sendResponse({ ok: true, settings: settings }); }, function (e) { sendResponse(fail(e)); });
    return true;
  }
  if (message.type === "login") {
    (async function () {
      try {
        var known = await loadSettings();
        var server = AXShare.api.normalizeServer(message.server) || known.server;
        if (!server) throw new Error("未获取到服务器地址，请检查后台服务是否在运行");
        var token = await AXShare.api.login(server, message.username, message.password);
        var account = await AXShare.api.profile(server, token);
        var saved = await saveSettings({
          server: server,
          serverManual: message.server ? server !== known.server : known.serverManual,
          token: token,
          userName: account.username || message.username,
          role: account.role || "",
          loginStamp: Date.now(),
        });
        sendResponse({ ok: true, settings: saved, profile: account });
      } catch (e) {
        sendResponse(fail(e));
      }
    })();
    return true;
  }
  if (message.type === "profile") {
    (async function () {
      var settings = await loadSettings();
      var server = AXShare.api.normalizeServer(message.server || settings.server);
      var token = message.token === undefined ? settings.token : message.token;
      if (!server || !token) {
        sendResponse({ ok: false, loggedIn: false, message: "尚未登录" });
        return;
      }
      try {
        var account = await AXShare.api.profile(server, token);
        sendResponse({ ok: true, loggedIn: true, profile: account, settings: settings });
      } catch (e) {
        sendResponse({ ok: false, loggedIn: false, message: fail(e).message });
      }
    })();
    return true;
  }
  if (message.type === "projects") {
    (async function () {
      try {
        var settings = await loadSettings();
        var server = AXShare.api.normalizeServer(message.server || settings.server);
        var token = message.token || settings.token;
        if (!server || !token) throw new Error("尚未登录");
        var projects = await AXShare.api.listProjects(server, token);
        sendResponse({ ok: true, projects: projects, server: server });
      } catch (e) {
        sendResponse(fail(e));
      }
    })();
    return true;
  }
  if (message.type === "project:create") {
    (async function () {
      try {
        var settings = await loadSettings();
        var server = AXShare.api.normalizeServer(message.server || settings.server);
        var token = message.token || settings.token;
        if (!server || !token) throw new Error("尚未登录");
        var created = await AXShare.api.createProject(server, token, message.name);
        sendResponse({ ok: true, project: created });
      } catch (e) {
        sendResponse(fail(e));
      }
    })();
    return true;
  }
  return false;
});
