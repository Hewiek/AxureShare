/* 页面内注入：识别 Axure 预览页，提供「同步原型」面板（选择项目 / 新建项目 / 替换更新原型）。 */
"use strict";

(function () {
  if (window.__axureshareHelperLoaded) return;
  window.__axureshareHelperLoaded = true;

  var D = AXShare.discover;
  var P = AXShare.picker;
  var NEW_PROJECT = "__new__";
  var STANDALONE = "";

  var state = {
    settings: null,
    opened: false,
    running: false,
    port: null,
    projects: [],
    mode: "existing",
    advancedOpen: false,
  };
  var host = null;
  var shadow = null;
  var els = {};

  var STYLES = `
    :host { all: initial; font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: inherit; }
    .fab { position: fixed; z-index: 2147483646; right: 20px; bottom: 20px; display: flex; gap: 8px; align-items: center;
      padding: 10px 16px; border: 0; border-radius: 999px; background: #2f6fed; color: #fff; font-size: 14px; cursor: pointer;
      box-shadow: 0 6px 20px rgba(0,0,0,.22); }
    .fab:hover { background: #2158c9; }
    .fab .dot { width: 8px; height: 8px; border-radius: 50%; background: #7dffa9; }
    .fab .dot.off { background: #ffd06a; }
    .panel { position: fixed; z-index: 2147483647; right: 20px; bottom: 72px; width: 356px; max-height: 82vh; overflow: auto;
      background: #fff; color: #1f2430; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.28); font-size: 13px; }
    .hd { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-bottom: 1px solid #eceff4; }
    .hd .title { font-size: 14px; font-weight: 600; }
    .hd .srv { font-size: 11px; color: #8b93a3; font-weight: 400; margin-left: 6px; }
    .hd button.x { border: 0; background: none; font-size: 18px; line-height: 1; cursor: pointer; color: #8b93a3; }
    .bd { padding: 12px 14px; display: grid; gap: 10px; }
    .acct { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: 8px;
      background: #f6f8fb; font-size: 12px; color: #5b6474; }
    .acct.on { background: #eefaf2; color: #1a7a4b; }
    .seg { display: flex; gap: 8px; }
    .seg-btn { flex: 1; border: 1px solid #d6dbe6; border-radius: 8px; background: #f6f8fc; color: #5b6472;
      font-size: 13px; padding: 7px 10px; cursor: pointer; }
    .seg-btn:hover { background: #eef2f8; }
    .seg-btn.active { border-color: #2f6fed; background: #eaf1ff; color: #1c4fd0; font-weight: 600; }
    .link-btn { border: 0; background: none; color: #2f6fed; font-size: 12px; cursor: pointer; padding: 2px 4px; white-space: nowrap; }
    .link-btn:hover { text-decoration: underline; }
    .btn { padding: 9px 10px; border-radius: 6px; border: 1px solid #d7dce5; background: #f6f8fb; color: #1f2430; font-size: 13px; cursor: pointer; }
    .btn:hover { background: #eef2f8; }
    .btn.primary { background: #2f6fed; border-color: #2f6fed; color: #fff; }
    .btn.primary:hover { background: #2158c9; }
    .btn.small { padding: 7px 9px; font-size: 12px; }
    .btn:disabled { opacity: .55; cursor: not-allowed; }
    .fld > label { display: block; margin-bottom: 4px; color: #5b6474; font-size: 12px; }
    .req { color: #d3382c; }
    .row { display: flex; gap: 8px; align-items: center; }
    .row > .grow { flex: 1; min-width: 0; }
    input.txt { width: 100%; padding: 7px 9px; border: 1px solid #d7dce5; border-radius: 6px; font-size: 13px; background: #fff; color: inherit; }
    input.txt:focus { outline: none; border-color: #2f6fed; }
    .adv { border: 1px dashed #e2e6ee; border-radius: 8px; padding: 8px 10px; display: grid; gap: 8px; }
    .adv .hd2 { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #5b6474; cursor: pointer; }
    .chk { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #1f2430; }
    .chk input { width: auto; }
    .adv .body { display: grid; gap: 8px; }
    .actions { display: grid; gap: 8px; grid-template-columns: 1fr 1fr; }
    .bar { height: 6px; border-radius: 3px; background: #eceff4; overflow: hidden; }
    .bar i { display: block; height: 100%; width: 0; background: #2f6fed; transition: width .2s; }
    .status { min-height: 18px; color: #5b6474; font-size: 12px; line-height: 1.5; word-break: break-all; }
    .status.err { color: #d3382c; }
    .status.ok { color: #1a9c5b; }
    .result { display: grid; gap: 6px; padding: 10px 14px; border-top: 1px solid #eceff4; font-size: 12px; color: #5b6474; }
    .result a { color: #2f6fed; text-decoration: none; word-break: break-all; }
  `;

  function fmtBytes(n) {
    if (!n && n !== 0) return "";
    if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
    if (n > 1024) return (n / 1024).toFixed(0) + " KB";
    return n + " B";
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setStatus(text, kind) {
    els.status.className = "status" + (kind ? " " + kind : "");
    els.status.textContent = text;
  }

  function setBar(fraction) {
    els.bar.style.width = Math.max(0, Math.min(100, (fraction || 0) * 100)) + "%";
  }

  function send(message) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(message, function (res) {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, message: chrome.runtime.lastError.message });
            return;
          }
          resolve(res);
        });
      } catch (e) {
        resolve({ ok: false, message: "扩展后台不可用，请刷新页面重试" });
      }
    });
  }

  /* 命中 AxureShare 后台站点时自动上报地址，插件无需手动填写服务器。 */
  async function reportSiteIfMatched() {
    if (!/^https?:/i.test(location.href)) return;
    try {
      var res = await fetch("/api/extension/config", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return;
      var data = await res.json();
      if (!data || !Object.prototype.hasOwnProperty.call(data, "server_url")) return;
      var canonical = "";
      try {
        canonical = new URL(data.server_url).origin;
      } catch (e) {
        /* server_url 异常时退回当前页面来源 */
      }
      await send({ type: "site:report", url: canonical || location.origin });
    } catch (e) {
      /* 非 AxureShare 页面，静默忽略 */
    }
  }
  reportSiteIfMatched();

  function buildPanel() {
    host = document.createElement("div");
    host.id = "axureshare-helper";
    shadow = host.attachShadow({ mode: "open" });
    var style = document.createElement("style");
    style.textContent = STYLES;
    shadow.appendChild(style);
    P.injectStyles(document, shadow);

    els.fab = el("button", "fab");
    els.dot = el("span", "dot");
    els.fab.appendChild(els.dot);
    els.fab.appendChild(el("span", null, "同步原型到 AxureShare"));
    els.fab.addEventListener("click", toggle);
    shadow.appendChild(els.fab);

    var panel = el("div", "panel");
    panel.style.display = "none";
    els.panel = panel;

    var hd = el("div", "hd");
    var hdLeft = el("div");
    hdLeft.appendChild(el("span", "title", "同步原型"));
    els.serverTag = el("span", "srv");
    hdLeft.appendChild(els.serverTag);
    hd.appendChild(hdLeft);
    var close = el("button", "x", "×");
    close.addEventListener("click", toggle);
    hd.appendChild(close);
    panel.appendChild(hd);

    var bd = el("div", "bd");

    els.acct = el("div", "acct");
    bd.appendChild(els.acct);

    els.segExisting = el("button", "seg-btn", "已有项目内替换");
    els.segNew = el("button", "seg-btn", "新建项目");
    els.segExisting.type = "button";
    els.segNew.type = "button";
    els.segExisting.addEventListener("click", function () {
      var value = els.projectPicker.getValue();
      applyMode(value && String(value) !== STANDALONE ? "existing" : "standalone");
    });
    els.segNew.addEventListener("click", function () { applyMode("new"); });
    var modeRow = el("div", "seg");
    modeRow.appendChild(els.segExisting);
    modeRow.appendChild(els.segNew);
    bd.appendChild(modeRow);

    els.projectPicker = P.create(shadow, {
      placeholder: "请选择或搜索需要更新的项目",
      emptyText: "暂无项目，可切换「新建项目」",
      onChange: onProjectChange,
    });
    els.projWrap = el("div", "fld");
    var projLabel = el("label", null, "项目");
    projLabel.appendChild(el("span", "req", " *"));
    els.projWrap.appendChild(projLabel);
    var projLine = el("div", "row");
    var projGrow = el("div", "grow");
    projGrow.appendChild(els.projectPicker.node);
    projLine.appendChild(projGrow);
    els.refresh = el("button", "btn small", "刷新");
    els.refresh.addEventListener("click", function () { loadProjects(); });
    projLine.appendChild(els.refresh);
    els.projWrap.appendChild(projLine);
    bd.appendChild(els.projWrap);

    els.newProjectName = el("input", "txt");
    els.newProjectName.placeholder = "如：2026-9-18 首页改版";
    els.newProjectField = el("div", "fld");
    els.newProjectField.appendChild(el("label", null, "新建项目名称"));
    els.newProjectField.appendChild(els.newProjectName);
    els.newProjectField.style.display = "none";
    bd.appendChild(els.newProjectField);

    els.protoPicker = P.create(shadow, {
      placeholder: "新原型名称（或选择项目内要替换的原型）",
      allowCustom: true,
      emptyText: "项目内暂无原型",
      onChange: onPrototypeChange,
    });
    els.protoField = el("div", "fld");
    var protoLabel = el("label", null, "原型名称");
    els.protoField.appendChild(protoLabel);
    els.protoField.appendChild(els.protoPicker.node);
    bd.appendChild(els.protoField);

    els.advanced = el("div", "adv");
    var advHead = el("div", "hd2");
    advHead.appendChild(el("span", null, "更多设置"));
    els.advToggle = el("span", null, "展开 ▾");
    advHead.appendChild(els.advToggle);
    advHead.addEventListener("click", toggleAdvanced);
    els.advanced.appendChild(advHead);
    els.advBody = el("div", "body");
    els.advBody.style.display = "none";
    els.isPublic = el("input");
    els.isPublic.type = "checkbox";
    var visLabel = el("label", "chk", "公开分享");
    visLabel.insertBefore(els.isPublic, visLabel.firstChild);
    els.password = el("input", "txt");
    els.password.type = "text";
    els.password.placeholder = "访问密码（留空保持不变）";
    els.advBody.appendChild(visLabel);
    els.advBody.appendChild(els.password);
    els.advanced.appendChild(els.advBody);
    bd.appendChild(els.advanced);

    els.actions = el("div", "actions");
    els.submit = el("button", "btn primary", "收集并上传");
    els.submit.addEventListener("click", start);
    els.cancel = el("button", "btn", "取消");
    els.cancel.style.display = "none";
    els.cancel.addEventListener("click", cancel);
    els.actions.appendChild(els.submit);
    els.actions.appendChild(els.cancel);
    bd.appendChild(els.actions);

    els.barWrap = el("div", "bar");
    els.bar = el("i");
    els.barWrap.appendChild(els.bar);
    bd.appendChild(els.barWrap);
    els.status = el("div", "status", "就绪");
    bd.appendChild(els.status);
    panel.appendChild(bd);

    els.result = el("div", "result");
    els.result.style.display = "none";
    panel.appendChild(els.result);

    shadow.appendChild(panel);
    document.documentElement.appendChild(host);
  }

  function toggleAdvanced() {
    state.advancedOpen = !state.advancedOpen;
    els.advBody.style.display = state.advancedOpen ? "grid" : "none";
    els.advToggle.textContent = state.advancedOpen ? "收起 ▴" : "展开 ▾";
  }

  function toggle() {
    state.opened = !state.opened;
    els.panel.style.display = state.opened ? "block" : "none";
    if (state.opened) {
      if (!document.getElementById("axureshare-helper")) document.documentElement.appendChild(host);
      renderAccount();
      if (isLoggedIn() && !state.projects.length) loadProjects();
    } else {
      els.projectPicker.close();
      els.protoPicker.close();
    }
  }

  function isLoggedIn() {
    return !!(state.settings && state.settings.server && state.settings.token);
  }

  function renderAccount() {
    var s = state.settings || {};
    els.serverTag.textContent = s.server || "未设置服务器";
    els.acct.innerHTML = "";
    els.acct.className = "acct" + (isLoggedIn() ? " on" : "");
    if (els.dot) els.dot.className = "dot" + (isLoggedIn() ? "" : " off");
    if (isLoggedIn()) {
      els.acct.appendChild(el("span", null, "已登录：" + (s.userName || "未知账号") + (s.role === "admin" ? "（管理员）" : "")));
      var logout = el("button", "link-btn", "退出");
      logout.addEventListener("click", logoutNow);
      els.acct.appendChild(logout);
    } else {
      els.acct.appendChild(el("span", null, "未登录"));
      var login = el("button", "link-btn", "登录");
      login.addEventListener("click", openLogin);
      els.acct.appendChild(login);
    }
  }

  function openLogin() {
    send({ type: "login:open" }).then(function (res) {
      if (!res || !res.ok) setStatus((res && res.message) || "无法打开登录窗口", "err");
      else setStatus("请在登录窗口完成登录后回到本页");
    });
  }

  function logoutNow() {
    send({ type: "logout" }).then(function (res) {
      if (res && res.settings) state.settings = res.settings;
      state.projects = [];
      els.projectPicker.setItems([{ value: STANDALONE, text: "（不归属项目 / 独立原型）" }]);
      els.projectPicker.setValue(null);
      applyMode("standalone");
      renderAccount();
      setStatus("已退出登录");
    });
  }

  function projectItems() {
    var list = [{ value: STANDALONE, text: "（不归属项目 / 独立原型）" }];
    state.projects.forEach(function (p) {
      list.push({
        value: String(p.id),
        text: p.name,
        meta: (p.prototype_count || (p.prototypes ? p.prototypes.length : 0)) + " 个原型",
      });
    });
    return list;
  }

  function applyMode(mode) {
    state.mode = mode;
    var isNew = mode === "new";
    if (els.projWrap) els.projWrap.style.display = isNew ? "none" : "block";
    els.newProjectField.style.display = isNew ? "block" : "none";
    els.segExisting.classList.toggle("active", !isNew);
    els.segNew.classList.toggle("active", isNew);
    if (isNew) {
      if (!els.newProjectName.value) els.newProjectName.value = els.protoPicker.getText() || defaultName();
      setTimeout(function () { els.newProjectName.focus(); }, 0);
    }
    refreshPrototypeItems();
  }

  function defaultName() {
    return D.exportRoot(document.URL).split("/").filter(Boolean).pop() || "";
  }

  function selectedProject() {
    var value = els.projectPicker.getValue();
    if (value === null || value === undefined || value === "" || value === NEW_PROJECT) return null;
    return state.projects.filter(function (p) { return String(p.id) === String(value); })[0] || null;
  }

  function refreshPrototypeItems() {
    var project = selectedProject();
    var protos = (project && project.prototypes) || [];
    els.protoPicker.setItems(protos.map(function (p) { return { value: p.name, text: p.name, meta: p.is_public ? "公开" : "私有" }; }));
  }

  function onProjectChange(selected) {
    if (!selected || String(selected.value) === STANDALONE) {
      applyMode("standalone");
      return;
    }
    applyMode("existing");
    applyPrototypeDefaults();
    persistProjectChoice();
  }

  function onPrototypeChange() {
    applyPrototypeDefaults();
  }

  function applyPrototypeDefaults() {
    var project = selectedProject();
    var name = els.protoPicker.getValue();
    var proto = project && (project.prototypes || []).filter(function (p) { return p.name === name; })[0];
    els.isPublic.checked = proto ? !!proto.is_public : !!(state.settings && state.settings.isPublic);
    if (!proto) els.password.value = "";
  }

  function persistProjectChoice() {
    var project = selectedProject();
    var patch = { projectId: project ? String(project.id) : "", projectName: project ? project.name : "" };
    send({ type: "settings:set", patch: patch });
  }

  async function loadProjects() {
    if (!isLoggedIn()) {
      renderAccount();
      setStatus("尚未登录", "err");
      return;
    }
    setStatus("正在读取项目库…");
    var res = await send({ type: "projects" });
    if (!res || !res.ok) {
      setStatus((res && res.message) || "读取项目库失败", "err");
      return;
    }
    state.projects = res.projects || [];
    els.projectPicker.setItems(projectItems());
    var remembered = state.settings && state.settings.projectId;
    if (remembered && els.projectPicker.setValue(remembered)) {
      applyMode("existing");
      applyPrototypeDefaults();
    } else {
      applyMode(state.projects.length ? "existing" : "standalone");
    }
    renderAccount();
    setStatus("项目 " + state.projects.length + " 个", "ok");
  }

  function collectSpec() {
    var docUrl = document.URL;
    var roots = D.rootCandidates(docUrl);
    var project = state.mode === "new" ? null : selectedProject();
    return {
      roots: roots,
      seeds: D.collectSeedUrls(document).concat(roots.length ? D.axureProbeUrls(roots[0]) : []),
      name: els.protoPicker.getValue() || defaultName(),
      projectId: project ? String(project.id) : STANDALONE,
      newProjectName: state.mode === "new" ? els.newProjectName.value.trim() : "",
      isPublic: !!els.isPublic.checked,
      accessPassword: els.password.value,
    };
  }

  function validate() {
    if (!isLoggedIn()) return "请先登录后再上传";
    if (!collectSpec().name) return "请填写原型名称";
    if (state.mode === "new" && !els.newProjectName.value.trim()) return "请填写新建项目名称";
    if (state.mode === "existing" && !selectedProject() && !els.projectPicker.getSelected()) {
      return "请选择项目，或点击「＋ 新建项目」";
    }
    return "";
  }

  function start() {
    if (state.running) return;
    var problem = validate();
    if (problem) {
      setStatus(problem, "err");
      return;
    }
    var spec = collectSpec();
    state.running = true;
    els.submit.disabled = true;
    els.cancel.style.display = "block";
    els.result.style.display = "none";
    els.result.innerHTML = "";
    setBar(0);
    setStatus("正在连接后台…");

    state.port = chrome.runtime.connect({ name: "job" });
    state.port.onMessage.addListener(function (msg) {
      if (!msg) return;
      if (msg.stage === "project") {
        setStatus(msg.text || "正在创建项目…");
        setBar(0.02);
      } else if (msg.stage === "collect") {
        if (msg.found === undefined) setStatus(msg.text || "正在定位导出目录…");
        else setStatus("收集资源：已抓 " + (msg.found || 0) + " 个，待抓 " + (msg.queued || 0) + " 个（" + fmtBytes(msg.bytes) + "）");
        setBar(0.05);
      } else if (msg.stage === "pack") {
        setStatus(msg.total ? "压缩打包：" + msg.done + "/" + msg.total + " 个文件" : "压缩打包…");
        setBar(0.3);
      } else if (msg.stage === "upload") {
        var frac = msg.total ? msg.sent / msg.total : 0;
        setStatus("上传中：" + fmtBytes(msg.sent) + " / " + fmtBytes(msg.total) + "（" + Math.round(frac * 100) + "%）");
        setBar(0.3 + 0.5 * frac);
      } else if (msg.stage === "extract") {
        var f2 = msg.total ? msg.loaded / msg.total : 0;
        setStatus("服务端解压：" + Math.round(f2 * 100) + "%" + (msg.error ? " · " + msg.error : ""));
        setBar(0.8 + 0.18 * f2);
      } else if (msg.stage === "done") {
        setBar(1);
        setStatus(msg.message || msg.text || "上传完成", "ok");
        showResult(msg.url, msg);
        finish();
        loadProjects();
      } else if (msg.stage === "error") {
        setStatus(msg.text || "上传失败", "err");
        finish();
      }
    });
    state.port.onDisconnect.addListener(function () {
      if (state.running) {
        setStatus("后台任务中断（可能是页面或浏览器休眠），请重试", "err");
        finish();
      }
    });
    state.port.postMessage({ type: "start", spec: spec });
  }

  function showResult(url, msg) {
    els.result.innerHTML = "";
    els.result.style.display = "grid";
    els.result.appendChild(el("div", null, "共 " + msg.files + " 个文件，打包后 " + fmtBytes(msg.bytes) + (msg.skipped ? "，跳过 " + msg.skipped + " 个" : "")));
    if (url) {
      var a = el("a", null, url);
      a.href = url;
      a.target = "_blank";
      els.result.appendChild(a);
      var copy = el("button", "btn small", "复制分享链接");
      copy.addEventListener("click", function () { copyText(url, copy); });
      els.result.appendChild(copy);
    }
  }

  function copyText(text, button) {
    var done = function () {
      button.textContent = "已复制";
      setTimeout(function () {
        button.textContent = "复制分享链接";
      }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else {
      fallbackCopy(text);
      done();
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {
      /* 忽略 */
    }
    document.body.removeChild(ta);
  }

  function cancel() {
    if (state.port) {
      try {
        state.port.disconnect();
      } catch (e) {
        /* 忽略 */
      }
      state.port = null;
    }
    setStatus("已取消", "err");
    finish();
  }

  function finish() {
    state.running = false;
    els.submit.disabled = false;
    els.cancel.style.display = "none";
  }

  function onStorageChanged(changes, area) {
    if (area !== "local" || !els.panel) return;
    var touched = ["token", "server", "userName", "role", "loginStamp"];
    if (!touched.some(function (key) { return changes[key]; })) return;
    send({ type: "settings:get" }).then(function (next) {
      state.settings = next && next.server !== undefined ? next : state.settings;
      renderAccount();
      if (isLoggedIn()) loadProjects();
    });
  }

  async function boot() {
    var settings = await send({ type: "settings:get" });
    state.settings = settings && settings.server !== undefined ? settings : null;
    if (state.settings && state.settings.server && location.href.indexOf(state.settings.server) === 0) return;

    var forced = !!(state.settings && state.settings.alwaysShow);
    if (!forced && !D.detect(document)) {
      if (/\.html?($|\?)/i.test(location.pathname) && D.collectSeedUrls(document).length > 6) {
        /* 普通 HTML 导出，允许手动模式 */
      } else {
        return;
      }
    }
    buildPanel();
    chrome.storage.onChanged.addListener(onStorageChanged);
    var preset = (state.settings && state.settings.prototypeName) || defaultName();
    els.protoPicker.setText(preset);
    applyMode("standalone");
    renderAccount();
    if (isLoggedIn()) {
      loadProjects();
    } else {
      setStatus("未登录，点击「登录」");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
