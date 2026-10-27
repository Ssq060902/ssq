/**
 * 图匣 PicVault — Popup UI
 */

const state = {
  images: [],
  selected: new Set(),
  filter: "all",
  meta: null,
};

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  $("btnRefresh").addEventListener("click", () => scan(true));
  $("chkAll").addEventListener("change", onToggleAll);
  $("btnDownload").addEventListener("click", onDownload);
  $("btnCopy").addEventListener("click", onCopy);
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.filter = chip.dataset.filter;
      render();
    });
  });
  scan(false);
});

async function scan(forceInject) {
  setBusy(true);
  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error("无法获取当前标签页");
    if (!/^https?:/i.test(tab.url || "")) {
      throw new Error("请在普通网页（http/https）上使用");
    }

    if (forceInject) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
    }

    const res = await sendToTab(tab.id, { type: "SCAN_IMAGES" });
    if (!res?.ok) throw new Error(res?.error || "扫描失败，请刷新页面后重试");

    state.meta = res.meta;
    state.images = res.images || [];
    state.selected = new Set(state.images.map((img) => img.url));

    $("pageHost").textContent = formatHostLabel(res.meta);
    $("prefix").value = suggestPrefix(res.meta);
    render();
    if (!state.images.length) toast("未找到图片，可滚动详情区后再刷新", "err");
  } catch (err) {
    state.images = [];
    state.selected.clear();
    render();
    $("pageHost").textContent = "扫描失败";
    toast(String(err?.message || err), "err");
  } finally {
    setBusy(false);
  }
}

function formatHostLabel(meta) {
  if (!meta) return "未知页面";
  const map = {
    taobao: "淘宝 / 天猫",
    jd: "京东",
    pdd: "拼多多",
    amazon: "Amazon",
    "1688": "1688",
    suning: "苏宁",
    douyin: "抖音电商",
    xhs: "小红书",
    generic: "通用页面",
  };
  const plat = map[meta.platform] || meta.platform;
  return `${plat} · ${meta.host}`;
}

function suggestPrefix(meta) {
  const raw = (meta?.title || "item").replace(/[<>:"/\\|?*\s]+/g, "_").slice(0, 24);
  return raw || "item";
}

function filteredImages() {
  if (state.filter === "all") return state.images;
  if (state.filter === "gallery") {
    return state.images.filter((i) => i.source === "gallery" || i.source === "meta");
  }
  if (state.filter === "detail") {
    return state.images.filter((i) => i.source === "detail");
  }
  return state.images;
}

function render() {
  const grid = $("grid");
  const empty = $("empty");
  const list = filteredImages();

  grid.innerHTML = "";
  $("countText").textContent = `${state.selected.size}/${state.images.length} 张`;

  if (!state.images.length) {
    empty.hidden = false;
    $("btnDownload").disabled = true;
    $("btnCopy").disabled = true;
    $("chkAll").checked = false;
    return;
  }

  empty.hidden = true;
  list.forEach((item) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card" + (state.selected.has(item.url) ? " selected" : "");
    card.title = item.alt || item.url;

    const img = document.createElement("img");
    img.src = item.thumb || item.url;
    img.alt = item.alt || "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";

    const tick = document.createElement("span");
    tick.className = "tick";

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = sourceLabel(item.source);

    card.append(img, tick, badge);
    card.addEventListener("click", () => toggleOne(item.url));
    card.addEventListener("mouseenter", () => highlight(item.url, true));
    card.addEventListener("mouseleave", () => highlight(item.url, false));
    grid.appendChild(card);
  });

  const visibleUrls = list.map((i) => i.url);
  const allSelected = visibleUrls.length > 0 && visibleUrls.every((u) => state.selected.has(u));
  $("chkAll").checked = allSelected;
  $("btnDownload").disabled = state.selected.size === 0;
  $("btnCopy").disabled = state.selected.size === 0;
}

function sourceLabel(source) {
  const map = { gallery: "主图", detail: "详情", meta: "封面", img: "图片", bg: "背景" };
  return map[source] || "图";
}

function toggleOne(url) {
  if (state.selected.has(url)) state.selected.delete(url);
  else state.selected.add(url);
  render();
}

function onToggleAll(e) {
  const list = filteredImages();
  if (e.target.checked) list.forEach((i) => state.selected.add(i.url));
  else list.forEach((i) => state.selected.delete(i.url));
  render();
}

async function onDownload() {
  const urls = [...state.selected];
  if (!urls.length) return;

  $("btnDownload").disabled = true;
  $("btnDownload").textContent = "下载中…";

  try {
    const res = await chrome.runtime.sendMessage({
      type: "DOWNLOAD_IMAGES",
      payload: {
        images: urls.map((url) => ({ url })),
        folder: "PicVault",
        prefix: $("prefix").value.trim() || "item",
      },
    });

    if (!res?.ok) throw new Error(res?.error || "下载失败");
    toast(`已开始下载 ${res.success}/${res.total} 张`, res.failed ? "err" : "ok");
  } catch (err) {
    toast(String(err?.message || err), "err");
  } finally {
    $("btnDownload").textContent = "下载选中";
    $("btnDownload").disabled = state.selected.size === 0;
  }
}

async function onCopy() {
  const urls = [...state.selected];
  try {
    await navigator.clipboard.writeText(urls.join("\n"));
    toast(`已复制 ${urls.length} 条链接`, "ok");
  } catch {
    toast("复制失败，请检查剪贴板权限", "err");
  }
}

async function highlight(url, on) {
  try {
    const tab = await getActiveTab();
    if (tab?.id) await sendToTab(tab.id, { type: "HIGHLIGHT", url, on });
  } catch {
    /* ignore */
  }
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs?.[0]));
  });
}

function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (res) => {
      if (chrome.runtime.lastError) {
        // content script 可能尚未注入
        chrome.scripting.executeScript(
          { target: { tabId }, files: ["content.js"] },
          () => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
              return;
            }
            chrome.tabs.sendMessage(tabId, message, (res2) => {
              if (chrome.runtime.lastError) {
                resolve({ ok: false, error: chrome.runtime.lastError.message });
              } else {
                resolve(res2);
              }
            });
          }
        );
      } else {
        resolve(res);
      }
    });
  });
}

function setBusy(busy) {
  $("btnRefresh").disabled = busy;
  if (busy) $("pageHost").textContent = "正在扫描…";
}

let toastTimer = null;
function toast(text, type = "ok") {
  const el = $("toast");
  el.hidden = false;
  el.textContent = text;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}
