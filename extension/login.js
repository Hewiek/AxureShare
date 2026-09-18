/* 登录弹窗：服务器地址来自后台下发，只在换取密钥失败时才允许手动改地址。 */
"use strict";

(function () {
  var $ = function (id) {
    return document.getElementById(id);
  };
  var els = {
    serverLine: $("serverLine"), serverRow: $("serverRow"), server: $("server"), serverEdit: $("serverEdit"),
    serverSave: $("serverSave"), username: $("username"), password: $("password"), submit: $("submit"),
    cancel: $("cancel"), status: $("status"), account: $("account"),
  };
  var serverAddr = "";
  var manual = false;

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

  function showServer() {
    els.serverLine.textContent = serverAddr || "未获取到服务器地址";
    els.serverRow.style.display = manual ? "flex" : "none";
    els.serverEdit.style.display = manual ? "none" : "inline";
  }

  async function submit() {
    var username = els.username.value.trim();
    var password = els.password.value;
    if (!serverAddr) {
      setStatus("未获取到服务器地址，请点击「改用其他地址」填写", "err");
      return;
    }
    if (!username || !password) {
      setStatus("请填写用户名和密码", "err");
      return;
    }
    els.submit.disabled = true;
    setStatus("正在登录…");
    var res = await send({ type: "login", server: serverAddr, username: username, password: password });
    els.submit.disabled = false;
    if (!res || !res.ok) {
      setStatus((res && res.message) || "登录失败", "err");
      return;
    }
    var account = res.profile || {};
    els.account.textContent = "已登录：" + (account.username || username) + "（" + (account.role === "admin" ? "管理员" : account.role || "用户") + "） · 可管理项目 " + (account.project_count || 0) + " 个";
    setStatus("登录成功，正在返回上传面板…", "ok");
    setTimeout(function () { window.close(); }, 700);
  }

  els.submit.addEventListener("click", submit);
  els.cancel.addEventListener("click", function () { window.close(); });
  els.serverEdit.addEventListener("click", function () {
    manual = true;
    els.server.value = serverAddr;
    showServer();
    els.server.focus();
  });
  els.serverSave.addEventListener("click", function () {
    var value = AXShare.api.normalizeServer(els.server.value);
    if (!value) {
      setStatus("请填写服务器地址", "err");
      return;
    }
    serverAddr = value;
    showServer();
    setStatus("已切换地址，点击「登录」生效");
  });
  [els.server, els.username, els.password].forEach(function (input) {
    input.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (manual && els.serverRow.style.display !== "none" && document.activeElement === els.server) {
        els.serverSave.click();
      } else {
        submit();
      }
    });
  });

  (async function init() {
    var settings = await send({ type: "settings:get" });
    serverAddr = (settings && settings.server) || "";
    manual = !!(settings && settings.serverManual);
    showServer();
    if (settings && settings.userName) {
      els.username.value = settings.userName;
      els.account.textContent = "当前已登录：" + settings.userName + (settings.role ? "（" + settings.role + "）" : "");
      setStatus("换账号登录会覆盖本机保存的密钥。");
    }
    if (manual) els.server.focus();
    else if (settings && settings.userName) els.password.focus();
    else els.username.focus();
  })();
})();
