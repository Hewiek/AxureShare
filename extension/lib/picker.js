/* 可搜索下拉选择器（combobox）：页面面板与扩展弹窗共用，样式由宿主注入一次。 */
(function (global) {
  "use strict";

  var CSS = `
    .ashx-combo { position: relative; display: flex; align-items: center; border: 1px solid #d7dce5; border-radius: 6px; background: #fff; }
    .ashx-combo:focus-within { border-color: #2f6fed; }
    .ashx-combo.disabled { background: #f5f6f9; opacity: .7; }
    .ashx-input { flex: 1; width: auto; min-width: 0; padding: 7px 4px 7px 9px; border: 0; background: transparent; font-size: 13px; color: inherit; outline: none; }
    .ashx-input::placeholder { color: #a7aeba; }
    .ashx-caret { padding: 0 9px; color: #8b93a3; font-size: 11px; line-height: 1; cursor: pointer; user-select: none; }
    .ashx-list { position: fixed; z-index: 2147483647; max-height: 190px; overflow: auto; margin: 0; padding: 4px; list-style: none;
      background: #fff; border: 1px solid #d7dce5; border-radius: 8px; box-shadow: 0 10px 28px rgba(15,23,42,.18); font-size: 13px; }
    .ashx-opt { padding: 7px 9px; border-radius: 5px; cursor: pointer; color: #1f2430; display: flex; justify-content: space-between; gap: 8px; }
    .ashx-opt:hover, .ashx-opt.active { background: #eef2f8; }
    .ashx-opt.selected { color: #2f6fed; font-weight: 600; }
    .ashx-opt .meta { color: #8b93a3; font-size: 11px; font-weight: 400; white-space: nowrap; }
    .ashx-action { border-top: 1px solid #eef1f5; margin-top: 3px; padding-top: 8px; border-radius: 0 0 5px 5px; color: #2f6fed; }
    .ashx-none { padding: 8px 9px; color: #a7aeba; font-size: 12px; }
  `;

  function injectStyles(doc, target) {
    var host = target || doc.head || doc.documentElement;
    if (!host || host.__ashxPickerCss) return;
    host.__ashxPickerCss = true;
    var node = doc.createElement("style");
    node.textContent = CSS;
    host.appendChild(node);
  }

  function create(root, opts) {
    var options = opts || {};
    var ownerDoc = root.ownerDocument || root;
    var win = ownerDoc.defaultView || global;
    var container = root === ownerDoc ? ownerDoc.body : root;
    var items = [];
    var shown = [];
    var selectable = [];
    var selected = null;
    var open = false;
    var active = null;
    var filterText = "";
    var allowCustom = !!options.allowCustom;

    var wrap = ownerDoc.createElement("div");
    wrap.className = "ashx-combo";
    var input = ownerDoc.createElement("input");
    input.type = "text";
    input.className = "ashx-input";
    input.autocomplete = "off";
    input.placeholder = options.placeholder || "请选择";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");
    var caret = ownerDoc.createElement("span");
    caret.className = "ashx-caret";
    caret.textContent = "▾";
    wrap.appendChild(input);
    wrap.appendChild(caret);

    var list = ownerDoc.createElement("ul");
    list.className = "ashx-list";
    list.style.display = "none";

    function emit(reason) {
      if (options.onChange) options.onChange(selected, reason);
    }

    function position() {
      if (!open) return;
      var rect = input.getBoundingClientRect();
      list.style.left = rect.left + "px";
      list.style.width = rect.width + "px";
      list.style.top = rect.bottom + 4 + "px";
      var viewportHeight = win.innerHeight || 600;
      if (rect.bottom + 4 + list.offsetHeight > viewportHeight - 8 && rect.top > list.offsetHeight + 8) {
        list.style.top = Math.max(8, rect.top - list.offsetHeight - 4) + "px";
      }
    }

    function render() {
      list.innerHTML = "";
      var text = filterText.trim().toLowerCase();
      shown = items.filter(function (item) {
        if (item.action) return true;
        return !text || item.text.toLowerCase().indexOf(text) >= 0;
      });
      selectable = shown.filter(function (item) { return !item.action; });
      if (!shown.length) {
        var none = ownerDoc.createElement("li");
        none.className = "ashx-none";
        none.textContent = options.emptyText || "无匹配项";
        list.appendChild(none);
      }
      shown.forEach(function (item) {
        var li = ownerDoc.createElement("li");
        var cls = ["ashx-opt"];
        if (item.action) cls.push("ashx-action");
        if (selected && !item.action && String(selected.value) === String(item.value)) cls.push("selected");
        if (active && active === item) cls.push("active");
        li.className = cls.join(" ");
        li.textContent = item.text;
        if (item.meta) {
          var meta = ownerDoc.createElement("span");
          meta.className = "meta";
          meta.textContent = item.meta;
          li.appendChild(meta);
        }
        li.addEventListener("mousedown", function (event) {
          event.preventDefault();
          if (item.action) {
            close();
            if (options.onAction) options.onAction(item.action, item);
            return;
          }
          choose(item);
        });
        list.appendChild(li);
      });
      position();
    }

    function openList() {
      if (open) return;
      open = true;
      active = null;
      input.setAttribute("aria-expanded", "true");
      if (!list.parentNode) container.appendChild(list);
      list.style.display = "block";
      render();
      root.addEventListener("mousedown", onDocMouseDown, true);
      win.addEventListener("scroll", position, true);
      win.addEventListener("resize", position);
    }

    function close() {
      if (!open) return;
      open = false;
      active = null;
      filterText = "";
      input.setAttribute("aria-expanded", "false");
      list.style.display = "none";
      root.removeEventListener("mousedown", onDocMouseDown, true);
      win.removeEventListener("scroll", position, true);
      win.removeEventListener("resize", position);
    }

    function onDocMouseDown(event) {
      if (wrap.contains(event.target) || list.contains(event.target)) return;
      commitText();
      close();
    }

    function find(value) {
      return items.filter(function (item) { return !item.action && String(item.value) === String(value); })[0];
    }

    function choose(item) {
      selected = item;
      input.value = item.text;
      close();
      emit("pick");
    }

    function commitText() {
      if (!allowCustom) {
        var exact = items.filter(function (item) { return !item.action && item.text === input.value.trim(); })[0];
        selected = exact || selected;
        input.value = selected ? selected.text : "";
        if (exact) emit("pick");
        return;
      }
      var text = input.value.trim();
      var hit = items.filter(function (item) { return !item.action && item.text === text; })[0];
      var next = text ? hit || { value: text, text: text, freeText: true } : null;
      if (JSON.stringify(next) === JSON.stringify(selected)) return;
      selected = next;
      emit("text");
    }

    caret.addEventListener("mousedown", function (event) {
      event.preventDefault();
      if (open) close();
      else {
        filterText = "";
        openList();
      }
    });
    input.addEventListener("focus", function () {
      filterText = "";
      openList();
    });
    input.addEventListener("input", function () {
      active = null;
      filterText = input.value;
      if (!open) openList();
      else render();
    });
    input.addEventListener("blur", commitText);
    input.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!open) openList();
        if (!selectable.length) return;
        var index = selectable.indexOf(active);
        index = event.key === "ArrowDown" ? index + 1 : index - 1;
        if (index < 0) index = selectable.length - 1;
        if (index >= selectable.length) index = 0;
        active = selectable[index];
        render();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (open && active) {
          choose(active);
          return;
        }
        commitText();
        close();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        input.value = selected ? selected.text : "";
      }
    });

    return {
      node: wrap,
      listNode: list,
      input: input,
      setItems: function (next) {
        items = next || [];
        if (selected && !selected.freeText && !find(selected.value)) {
          if (allowCustom) {
            var keepText = input.value.trim() || selected.text;
            selected = { value: keepText, text: keepText, freeText: true };
          } else {
            selected = null;
            input.value = "";
          }
        }
        if (open) render();
      },
      setValue: function (value) {
        var hit = find(value);
        selected = hit || null;
        input.value = hit ? hit.text : "";
        return !!hit;
      },
      setText: function (text) {
        input.value = text || "";
        var hit = items.filter(function (item) { return !item.action && item.text === input.value.trim(); })[0];
        selected = hit || (text ? { value: text, text: text, freeText: true } : null);
      },
      getText: function () {
        return input.value.trim();
      },
      getValue: function () {
        return selected ? selected.value : "";
      },
      getSelected: function () {
        return selected;
      },
      isFreeText: function () {
        return !!(selected && selected.freeText);
      },
      setDisabled: function (flag) {
        input.disabled = !!flag;
        wrap.classList[flag ? "add" : "remove"]("disabled");
      },
      focus: function () {
        input.focus();
      },
      close: close,
    };
  }

  global.AXShare = global.AXShare || {};
  global.AXShare.picker = { create: create, CSS: CSS, injectStyles: injectStyles };
})(typeof self !== "undefined" ? self : globalThis);
