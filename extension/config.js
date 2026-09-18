/* 接入配置：打包时只需改 BOOTSTRAP_SERVER；运行时会用后台下发的地址覆盖它。 */
(function (global) {
  "use strict";

  var BOOTSTRAP_SERVER = "http://192.168.1.34:7855";

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
