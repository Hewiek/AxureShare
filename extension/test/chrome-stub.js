/* 开发用假 chrome 运行时：让 popup / login / content 面板能在普通标签页里预览，不发起任何网络请求。 */
(function () {
  var defaults = {
    server: "http://127.0.0.1:7855",
    token: "preview-token",
    userName: "admin",
    role: "admin",
    loginStamp: 1,
    projectId: "2",
    projectName: "扩展端到端项目",
    prototypeName: "扩展端到端验证",
    isPublic: false,
    alwaysShow: true,
    lastUploadUrl: "",
    serverManual: false,
    configStamp: Date.now(),
  };

  function makeProjects() {
    return [
      {
        id: 1,
        name: "2026-9-2 AI任务生成-可灵-动作控制",
        owner: "admin",
        is_owner: true,
        prototype_count: 2,
        prototypes: [
          { id: 11, name: "可灵动作控制 V1.2", is_public: true, has_access_password: false, resource_type: "axure" },
          { id: 12, name: "可灵动作控制 V1.1", is_public: false, has_access_password: true, resource_type: "axure" },
        ],
      },
      {
        id: 2,
        name: "扩展端到端项目",
        owner: "admin",
        is_owner: true,
        prototype_count: 1,
        prototypes: [{ id: 3, name: "扩展端到端验证", is_public: true, has_access_password: false, resource_type: "axure" }],
      },
      { id: 3, name: "2025-6-1 超级签管理", owner: "admin", is_owner: true, prototype_count: 0, prototypes: [] },
    ];
  }

  var state = { store: Object.assign({}, defaults), projects: makeProjects(), log: [] };

  window.__axStub = {
    state: state,
    reset: function () {
      state.store = Object.assign({}, defaults);
      state.projects = makeProjects();
      state.log = [];
    },
    setLoggedOut: function () {
      state.store.token = "";
      state.store.userName = "";
      state.store.role = "";
    },
    setNoServer: function () {
      state.store.server = "";
    },
  };

  function respond(message) {
    var store = state.store;
    if (message.type === "settings:get") return Object.assign({}, store);
    if (message.type === "settings:set") return Object.assign({}, store, message.patch);
    if (message.type === "projects") return { ok: true, projects: state.projects, server: store.server };
    if (message.type === "project:create") {
      var project = { id: 900 + state.projects.length, name: message.name, owner: "admin", is_owner: true, prototype_count: 0, prototypes: [] };
      state.projects.push(project);
      return { ok: true, project: project };
    }
    if (message.type === "logout") {
      store.token = "";
      store.userName = "";
      store.role = "";
      return { ok: true, settings: Object.assign({}, store) };
    }
    if (message.type === "config:refresh") {
      return { ok: true, settings: Object.assign({}, store) };
    }
    if (message.type === "login") {
      if (message.username !== "admin" || message.password !== "123456") return { ok: false, message: "用户名或密码错误" };
      store.serverManual = !!message.server && message.server !== store.server;
      store.server = message.server || store.server;
      store.token = "preview-token";
      store.userName = message.username;
      store.role = "admin";
      return { ok: true, settings: Object.assign({}, store), profile: { username: message.username, role: "admin", project_count: state.projects.length } };
    }
    if (message.type === "login:open") {
      window.__previewLoginOpened = (window.__previewLoginOpened || 0) + 1;
      return { ok: true, windowId: 1 };
    }
    return { ok: false, message: "未知消息类型 " + message.type };
  }

  /* 预览时禁用关闭标签页，避免把宿主浏览器一起带走。 */
  window.close = function () { window.__previewCloseCalled = (window.__previewCloseCalled || 0) + 1; };

  window.chrome = {
    runtime: {
      lastError: null,
      id: "preview-extension",
      getURL: function (p) { return p; },
      connect: function () {
        return {
          onMessage: { addListener: function () {} },
          onDisconnect: { addListener: function () {} },
          postMessage: function (msg) { state.log.push(["job", msg]); },
          disconnect: function () {},
        };
      },
      sendMessage: function (message, cb) {
        var res = respond(message);
        state.log.push(["msg", message, res]);
        if (cb) setTimeout(function () { cb(res); }, 0);
      },
    },
    storage: { onChanged: { addListener: function () {} } },
  };
})();
