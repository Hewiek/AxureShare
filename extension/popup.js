/* 扩展弹窗：登录态、默认项目（含新建）、本地文件夹直传。 */
"use strict";

(function () {
  var NEW_PROJECT = "__new__";
  var STANDALONE = "";
  var $ = function (id) {
    return document.getElementById(id);
  };
  var els = {};
  ["alwaysShow", "account", "serverLine", "projectPicker", "refresh", "newProjectRow", "newProjectName",
    "segExisting", "segNew",
    "pickFolder", "folderPublic", "folderName", "bar", "status", "result"].forEach(function (id) {
    els[id] = $(id);
  });

  var settings = {};
  var projects = [];
  var mode = "standalone";
  var picker = null;

  AXShare.picker.injectStyles(document, document.head);

  function send(message) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(message, function (res) {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, message: chrome.runtime.lastError.message });
          return;
        }
        resolve(res);
      });
    });
  }

  function setStatus(text, kind) {
    els.status.textContent = text;
    els.status.className = "status" + (kind ? " " + kind : "");
  }

  function setBar(fraction) {
    els.bar.style.width = Math.max(0, Math.min(100, (fraction || 0) * 100)) + "%";
  }

  function fmtBytes(n) {
    if (!n && n !== 0) return "";
    if (n > 1048576) return (n / 1048576).toFixed(1) + " MB";
    if (n > 1024) return (n / 1024).toFixed(0) + " KB";
    return n + " B";
  }

  function isLoggedIn() {
    return !!(settings.server && settings.token);
  }

  function renderAccount() {
    els.account.innerHTML = "";
    els.account.className = "acct" + (isLoggedIn() ? " on" : "");
    var text = document.createElement("span");
    var button = document.createElement("button");
    button.className = "link-btn";
    if (isLoggedIn()) {
      text.textContent = "已登录：" + (settings.userName || "未知账号") + (settings.role === "admin" ? "（管理员）" : "") + " · 项目 " + projects.length + " 个";
      button.textContent = "退出";
      button.addEventListener("click", async function () {
        var res = await send({ type: "logout" });
        applySettings((res && res.settings) || {});
        projects = [];
        picker.setItems(projectItems());
        applyMode("standalone");
        setStatus("已退出登录");
      });
    } else {
      text.textContent = "未登录";
      button.textContent = "登录";
      button.addEventListener("click", function () {
        send({ type: "login:open" });
      });
    }
    els.account.appendChild(text);
    els.account.appendChild(button);
  }

  function projectItems() {
    var list = [{ value: STANDALONE, text: "（不归属项目 / 独立原型）" }];
    projects.forEach(function (p) {
      list.push({
        value: String(p.id),
        text: p.name,
        meta: ((p.prototypes || []).length || p.prototype_count || 0) + " 原型",
      });
    });
    return list;
  }

  function selectedProject() {
    var value = picker.getValue();
    if (!value || value === NEW_PROJECT) return null;
    return projects.filter(function (p) { return String(p.id) === String(value); })[0] || null;
  }

  function applyMode(next) {
    mode = next;
    var isNew = next === "new";
    els.newProjectRow.style.display = isNew ? "block" : "none";
    els.segExisting.classList.toggle("active", !isNew);
    els.segNew.classList.toggle("active", isNew);
    if (isNew) {
      if (!els.newProjectName.value) els.newProjectName.value = els.folderName.value.trim();
      els.newProjectName.focus();
    }
  }

  function applySettings(next) {
    settings = next || {};
    els.serverLine.textContent = settings.server || "";
    els.alwaysShow.checked = !!settings.alwaysShow;
    renderAccount();
  }

  function collectPatch() {
    return {
      alwaysShow: els.alwaysShow.checked,
      projectId: mode === "new" ? "" : selectedProject() ? String(selectedProject().id) : STANDALONE,
      projectName: mode === "new" ? "" : selectedProject() ? selectedProject().name : "",
    };
  }

  async function persist() {
    var saved = await send({ type: "settings:set", patch: collectPatch() });
    if (saved && saved.server !== undefined) {
      settings = Object.assign({}, settings, saved);
      els.serverLine.textContent = saved.server || "";
    }
    return saved;
  }

  async function loadProjects() {
    if (!isLoggedIn()) {
      setStatus("尚未登录", "err");
      renderAccount();
      return;
    }
    const remembered = settings.projectId;
    await persist();
    setStatus("正在读取项目库…");
    var res = await send({ type: "projects" });
    if (!res || !res.ok) {
      setStatus((res && res.message) || "读取项目库失败", "err");
      return;
    }
    projects = res.projects || [];
    picker.setItems(projectItems());
    if (remembered && picker.setValue(remembered)) applyMode("existing");
    else applyMode("standalone");
    renderAccount();
    setStatus("项目 " + projects.length + " 个", "ok");
  }

  async function resolveProjectId() {
    if (mode !== "new") return selectedProject() ? String(selectedProject().id) : STANDALONE;
    var name = els.newProjectName.value.trim();
    if (!name) throw new Error("请填写新建项目名称");
    var res = await send({ type: "project:create", name: name });
    if (!res || !res.ok) throw new Error((res && res.message) || "创建项目失败");
    projects.push({ id: res.project.id, name: res.project.name, prototypes: res.project.prototypes || [] });
    picker.setItems(projectItems());
    picker.setValue(String(res.project.id));
    applyMode("existing");
    return String(res.project.id);
  }

  var JUNK = /^(\.|~\$)|\.(tmp|lock)$/i;
  function isJunk(name) {
    return JUNK.test(name) || /^(Thumbs\.db|desktop\.ini)$/i.test(name);
  }

  async function walkDirectory(dirHandle, prefix, out) {
    for await (const entry of dirHandle.values()) {
      if (out.length >= 4000) return;
      var name = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.kind === "file") {
        if (!isJunk(entry.name)) out.push({ name: name, handle: entry });
      } else {
        await walkDirectory(entry, name, out);
      }
    }
  }

  async function uploadFolder() {
    if (!isLoggedIn()) {
      setStatus("请先登录", "err");
      return;
    }
    if (!window.showDirectoryPicker) {
      setStatus("当前浏览器不支持选择文件夹", "err");
      return;
    }
    await persist();
    var dirHandle;
    try {
      dirHandle = await window.showDirectoryPicker();
    } catch (e) {
      setStatus("已取消选择", "");
      return;
    }

    els.result.innerHTML = "";
    setBar(0.02);
    setStatus("正在读取「" + dirHandle.name + "」目录…");
    var found = [];
    await walkDirectory(dirHandle, "", found);
    if (!found.length) {
      setStatus("文件夹为空", "err");
      return;
    }

    var bytes = 0;
    var entries = [];
    for (var i = 0; i < found.length; i++) {
      var file = await found[i].handle.getFile();
      bytes += file.size;
      if (bytes > 800 * 1024 * 1024) {
        setStatus("文件总大小超过 800MB，已中止", "err");
        return;
      }
      entries.push({ name: found[i].name, data: file });
      if (i % 25 === 0) {
        setBar(0.02 + 0.26 * (i / found.length));
        setStatus("读取文件：" + (i + 1) + "/" + found.length + "（" + fmtBytes(bytes) + "）");
      }
    }

    var projectId;
    try {
      projectId = await resolveProjectId();
    } catch (e) {
      setStatus(e.message || String(e), "err");
      return;
    }

    setBar(0.3);
    setStatus("正在压缩打包 " + entries.length + " 个文件…");
    var zip = await AXShare.zip.buildZip(entries);

    var name = els.folderName.value.trim() || dirHandle.name;
    var uploadId = "ext-folder-" + Date.now();
    var polling = true;
    (async function () {
      while (polling) {
        try {
          var p = await AXShare.api.getProgress(settings.server, settings.token, uploadId);
          if (p && p.stage && p.stage !== "unknown" && p.total) {
            setStatus("服务端解压：" + Math.round((p.loaded / p.total) * 100) + "%" + (p.error ? " · " + p.error : ""));
            setBar(0.85 + 0.14 * (p.loaded / p.total));
          }
        } catch (e) {
          /* 忽略轮询错误 */
        }
        await new Promise(function (r) { setTimeout(r, 500); });
      }
    })();

    setStatus("开始上传（请勿关闭本窗口）…");
    try {
      var result = await AXShare.api.upload({
        server: settings.server,
        token: settings.token,
        name: name,
        projectId: projectId,
        isPublic: els.folderPublic.checked,
        uploadId: uploadId,
        zip: zip,
        onSend: function (sent, total) {
          setBar(0.34 + 0.5 * (sent / total));
          setStatus("上传中：" + fmtBytes(sent) + " / " + fmtBytes(total));
        },
      });
      polling = false;
      setBar(1);
      setStatus((result && result.message) || "上传完成", "ok");
      if (result && result.short_id) {
        var url = settings.server + "/v/" + result.short_id + "/";
        els.result.innerHTML = "";
        var a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.textContent = url;
        els.result.appendChild(a);
      }
      loadProjects();
    } catch (e) {
      polling = false;
      setStatus(e && e.message ? e.message : String(e), "err");
    }
  }

  els.alwaysShow.addEventListener("change", persist);
  els.refresh.addEventListener("click", loadProjects);
  els.pickFolder.addEventListener("click", uploadFolder);
  els.segExisting.addEventListener("click", function () {
    var value = picker.getValue();
    applyMode(value && String(value) !== STANDALONE ? "existing" : "standalone");
  });
  els.segNew.addEventListener("click", function () {
    applyMode("new");
  });

  picker = AXShare.picker.create(document, {
    placeholder: "请选择或搜索需要更新的项目",
    emptyText: "暂无项目，可新建项目",
    onChange: function (selected) {
      if (!selected || String(selected.value) === STANDALONE) {
        applyMode("standalone");
        return;
      }
      applyMode("existing");
      persist();
    },
    onAction: function () {
      applyMode("new");
    },
  });
  els.projectPicker.appendChild(picker.node);

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    if (!["token", "server", "userName", "role", "loginStamp"].some(function (key) { return changes[key]; })) return;
    send({ type: "settings:get" }).then(function (next) {
      applySettings(next || {});
      if (isLoggedIn()) loadProjects();
    });
  });

  (async function init() {
    applySettings((await send({ type: "settings:get" })) || {});
    picker.setItems(projectItems());
    applyMode("standalone");
    if (isLoggedIn()) {
      loadProjects();
    } else {
      setStatus("登录后即可上传");
    }
  })();
})();
