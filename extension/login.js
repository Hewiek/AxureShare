/* 登录弹窗：服务器地址全自动——打开后台页面时由内容脚本上报，其次由后台下发，无需手动填写。 */
"use strict";

(function () {
  var $ = function (id) {
    return document.getElementById(id);
  };
  var els = {
    serverLine: $("serverLine"), username: $("username"), password: $("password"), submit: $("submit"),
    cancel: $("cancel"), status: $("status"), account: $("account"),
  };
  var serverAddr = "";

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
    els.serverLine.textContent = serverAddr
      ? "服务器：" + serverAddr + "（自动识别）"
      : "未识别到服务器地址，请先在浏览器打开 AxureShare 后台页面";
  }

  async function submit() {
    var username = els.username.value.trim();
    var password = els.password.value;
    if (!serverAddr) {
      setStatus("未识别到服务器地址，请先在浏览器打开 AxureShare 后台页面后重新登录", "err");
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
  [els.username, els.password].forEach(function (input) {
    input.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      submit();
    });
  });

  async function refreshServer() {
    var settings = await send({ type: "settings:get" });
    var next = (settings && settings.server) || "";
    if (next && next !== serverAddr) {
      serverAddr = next;
      showServer();
    }
    return settings;
  }

  (async function init() {
    var settings = await refreshServer();
    if (settings && settings.userName) {
      els.username.value = settings.userName;
      els.account.textContent = "当前已登录：" + settings.userName + (settings.role ? "（" + settings.role + "）" : "");
      setStatus("换账号登录会覆盖本机保存的密钥。");
    }
    if (settings && settings.userName) els.password.focus();
    else els.username.focus();

    /* 后台页面上报是异步的：短时间内多次回读，让自动识别尽快显示。 */
    if (!serverAddr) {
      [800, 2000, 4000].forEach(function (delay) {
        setTimeout(function () { refreshServer(); }, delay);
      });
    }
  })();
})();
