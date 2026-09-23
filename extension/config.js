/* 接入配置：BOOTSTRAP_SERVER 仅为初始兜底；打开后台页面时插件会自动识别并覆盖。 */
(function (global) {
  "use strict";

  var BOOTSTRAP_SERVER = "http://192.168.1.230:7855";

  /* 后台「服务配置 → 站点访问地址」的当前值；未配置时服务端回显本次请求的主机名。 */
  async function fetchServer(server) {
    var res = await global.AXShare.api.request(server, "/api/extension/config");
    var value = res.ok && res.data && res.data.server_url;
    if (!value) throw new Error("后台未下发服务地址（HTTP " + res.status + "）");
    return global.AXShare.api.normalizeServer(value);
  }

  global.AXShare = global.AXShare || {};
  global.AXShare.config = { BOOTSTRAP_SERVER: BOOTSTRAP_SERVER, fetchServer: fetchServer };
})(typeof self !== "undefined" ? self : globalThis);
