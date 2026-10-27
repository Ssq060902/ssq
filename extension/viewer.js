/**
 * 图匣 PicVault — 图库页
 * 展示采集结果；单张导出 PNG，多张打包 ZIP
 */

const state = {
  job: null,
  selected: new Set(),
  filter: "all",
  busy: false,
};

const $ = (id) => document.getElementById(id);
const PLATFORM = {
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

document.addEventListener("DOMContentLoaded", init);

async function init() {
  $("chkAll").addEventListener("change", onToggleAll);
  $("btnPng").addEventListener("click", () => downloadSelection("png"));
  $("btnZip").addEventListener("click", () => downloadSelection("zip"));
  $("lbClose").addEventListener("click", closeLightbox);
  $("lightbox").addEventListener("click", (e) => {
    if (e.target.id === "lightbox") closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.filter = chip.dataset.filter;
      render();
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.picvaultJob) return;
    applyJob(changes.picvaultJob.newValue);
  });

  const { picvaultJob: job } = await chrome.storage.local.get("picvaultJob");
  applyJob(job);
}

function applyJob(job) {
  state.job = job || {
    ok: false,
    loading: false,
    error: "没有采集数据。请打开商品详情页后点击图匣。",
    images: [],
    meta: {},
  };

  const meta = state.job.meta || {};
  const plat = PLATFORM[meta.platform] || meta.platform || "";
  if (state.job.loading) {
    $("pageTitle").textContent = "正在采集商品页全部图片…";
    $("status").textContent = "已滚动加载详情图，请稍候";
  } else if (state.job.ok === false && state.job.error) {
    $("pageTitle").textContent = state.job.error;
    $("status").textContent = "";
  } else {
    $("pageTitle").textContent = [plat, meta.host, meta.title].filter(Boolean).join(" · ") || "商品图库";
    $("status").textContent = "";
  }

  if (meta.url) {
    const a = $("sourceLink");
    a.href = meta.url;
    a.hidden = false;
  }

  if (!$("prefix").value) $("prefix").value = suggestPrefix(meta);
  state.selected = new Set((state.job.images || []).map((img) => img.url));
  render();

  if (!state.job.loading && !state.job.images?.length) {
    toast(state.job.error || "未找到图片", "err");
  }
}

function suggestPrefix(meta) {
  return String(meta?.title || "item")
    .replace(/[<>:"/\\|?*\s]+/g, "_")
    .slice(0, 24) || "item";
}

function filteredImages() {
  const images = state.job?.images || [];
  if (state.filter === "gallery") {
    return images.filter((i) => i.source === "gallery" || i.source === "meta");
  }
  if (state.filter === "detail") return images.filter((i) => i.source === "detail");
  return images;
}

function render() {
  const grid = $("grid");
  const empty = $("empty");
  const list = filteredImages();
  const all = state.job?.images || [];

  grid.innerHTML = "";
  $("countText").textContent = `${state.selected.size} / ${all.length} 张`;

  if (!all.length) {
    empty.hidden = false;
    $("btnPng").disabled = true;
    $("btnZip").disabled = true;
    $("chkAll").checked = false;
    return;
  }

  empty.hidden = true;
  list.forEach((item, idx) => {
    const card = document.createElement("article");
    card.className = "card" + (state.selected.has(item.url) ? " selected" : "");

    const img = document.createElement("img");
    img.src = item.thumb || item.url;
    img.alt = item.alt || `图 ${idx + 1}`;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("click", () => openLightbox(item.url));

    const tick = document.createElement("button");
    tick.type = "button";
    tick.className = "tick";
    tick.title = "选择";
    tick.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleOne(item.url);
    });

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = sourceLabel(item.source);

    const mini = document.createElement("button");
    mini.type = "button";
    mini.className = "mini";
    mini.textContent = "PNG";
    mini.title = "下载为 PNG";
    mini.addEventListener("click", (e) => {
      e.stopPropagation();
      downloadOnePng(item);
    });

    card.append(img, tick, badge, mini);
    grid.appendChild(card);
  });

  const visible = list.map((i) => i.url);
  $("chkAll").checked = visible.length > 0 && visible.every((u) => state.selected.has(u));
  const n = state.selected.size;
  $("btnPng").disabled = n === 0 || state.busy;
  $("btnZip").disabled = n === 0 || state.busy;
}

function sourceLabel(source) {
  return { gallery: "主图", detail: "详情", meta: "封面", img: "图片", bg: "背景" }[source] || "图";
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

function selectedItems() {
  const set = state.selected;
  return (state.job?.images || []).filter((i) => set.has(i.url));
}

async function downloadSelection(force) {
  const items = selectedItems();
  if (!items.length) return;

  if (force === "zip") {
    await downloadZip(items);
    return;
  }

  if (items.length === 1) {
    await downloadOnePng(items[0]);
    return;
  }

  setBusy(true, `正在导出 ${items.length} 张 PNG…`);
  let ok = 0;
  try {
    for (let i = 0; i < items.length; i++) {
      $("status").textContent = `导出 PNG ${i + 1}/${items.length}…`;
      try {
        const blob = await urlToPngBlob(items[i].url);
        await saveBlob(blob, `${folderPrefix()}/${filePrefix()}_${pad(i + 1)}.png`);
        ok += 1;
      } catch {
        /* skip */
      }
    }
    toast(ok ? `已开始下载 ${ok} 张 PNG` : "PNG 导出失败", ok ? "ok" : "err");
  } finally {
    setBusy(false);
  }
}

async function downloadOnePng(item) {
  setBusy(true, "正在转为 PNG…");
  try {
    const blob = await urlToPngBlob(item.url);
    const seq = pad(Math.max(1, indexOf(item) + 1));
    await saveBlob(blob, `${folderPrefix()}/${filePrefix()}_${seq}.png`);
    toast("已开始下载 PNG", "ok");
  } catch (err) {
    toast(String(err?.message || err), "err");
  } finally {
    setBusy(false);
  }
}

async function downloadZip(items) {
  setBusy(true, `正在打包 ${items.length} 张 PNG…`);
  const files = [];
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    $("status").textContent = `转换 PNG ${i + 1}/${items.length}…`;
    try {
      const blob = await urlToPngBlob(item.url);
      const data = new Uint8Array(await blob.arrayBuffer());
      files.push({ name: `${filePrefix()}_${pad(i + 1)}.png`, data });
    } catch {
      failed += 1;
    }
  }

  if (!files.length) {
    setBusy(false);
    toast("全部转换失败，可能被站点防盗链拦截", "err");
    return;
  }

  $("status").textContent = "正在生成 ZIP…";
  const zipBlob = PicVaultZip.buildZip(files);
  const zipName = `${folderPrefix()}/${filePrefix()}_${stamp()}.zip`;
  try {
    await saveBlob(zipBlob, zipName);
    toast(`ZIP 已开始下载（${files.length} 张 PNG${failed ? `，失败 ${failed}` : ""}）`, failed ? "err" : "ok");
  } catch (err) {
    toast(String(err?.message || err), "err");
  } finally {
    setBusy(false);
  }
}

function indexOf(item) {
  return (state.job?.images || []).findIndex((i) => i.url === item.url);
}

function folderPrefix() {
  return "PicVault";
}

function filePrefix() {
  return ($("prefix").value.trim() || "item").replace(/[<>:"/\\|?*]+/g, "_").slice(0, 40);
}

function pad(n) {
  return String(n).padStart(3, "0");
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

async function fetchImageBlob(url) {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (res.ok) return await res.blob();
  } catch {
    /* 走后台拉取 */
  }
  const res = await chrome.runtime.sendMessage({ type: "FETCH_BYTES", url });
  if (!res?.ok) throw new Error(res?.error || "无法读取图片");
  return new Blob([res.buffer], { type: res.mime || "image/jpeg" });
}

async function urlToPngBlob(url) {
  const srcBlob = await fetchImageBlob(url);
  let bitmap;
  try {
    bitmap = await createImageBitmap(srcBlob);
  } catch {
    throw new Error("图片解码失败");
  }
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 编码失败"))), "image/png");
  });
  return png;
}

async function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url,
      filename,
      conflictAction: "uniquify",
      saveAs: false,
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

function setBusy(busy, text = "") {
  state.busy = busy;
  $("status").textContent = text;
  $("btnPng").disabled = busy || state.selected.size === 0;
  $("btnZip").disabled = busy || state.selected.size === 0;
}

function openLightbox(url) {
  $("lbImg").src = url;
  $("lightbox").hidden = false;
}

function closeLightbox() {
  $("lightbox").hidden = true;
  $("lbImg").src = "";
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
  }, 2800);
}
