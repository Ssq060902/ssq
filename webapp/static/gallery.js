/**
 * 图匣 PicVault — 图库页（网页版）
 * 通过后端代理拉图，前端转 PNG / 打包 ZIP
 */

const state = {
  job: null,
  selected: new Set(),
  filter: "all",
  busy: false,
};

const $ = (id) => document.getElementById(id);
const SOURCE_LABEL = { gallery: "主图", detail: "详情", meta: "封面", img: "图片", bg: "背景" };

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

  const jobId = new URLSearchParams(location.search).get("job");
  if (!jobId) {
    showError("缺少任务参数，请回到首页输入商品链接");
    return;
  }

  try {
    const res = await fetch(`/api/job/${encodeURIComponent(jobId)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "载入失败");
    applyJob(data.job);
  } catch (err) {
    showError(String(err?.message || err));
  }
}

function applyJob(job) {
  state.job = job || { title: "商品图库", url: "", host: "", images: [] };
  const meta = state.job;

  $("pageTitle").textContent = [meta.host, meta.title].filter(Boolean).join(" · ") || "商品图库";
  if (meta.url) {
    const a = $("sourceLink");
    a.href = meta.url;
    a.hidden = false;
  }

  $("prefix").value = suggestPrefix(meta.title);
  state.selected = new Set((meta.images || []).map((img) => img.url));
  render();

  if (!meta.images?.length) {
    toast("未找到图片", "err");
  }
}

function showError(msg) {
  $("pageTitle").textContent = msg;
  $("empty").hidden = false;
  $("empty").querySelector("p").textContent = msg;
}

function suggestPrefix(title) {
  return String(title || "item").replace(/[<>:"/\\|?*\s]+/g, "_").slice(0, 24) || "item";
}

function proxyUrl(u) {
  const ref = state.job?.url || "";
  return `/api/proxy?url=${encodeURIComponent(u)}&ref=${encodeURIComponent(ref)}`;
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
    img.src = proxyUrl(item.url);
    img.alt = item.alt || `图 ${idx + 1}`;
    img.loading = "lazy";
    img.addEventListener("click", () => openLightbox(proxyUrl(item.url)));

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
    badge.textContent = SOURCE_LABEL[item.source] || "图";

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
        const blob = await urlToPngBlob(proxyUrl(items[i].url));
        await saveBlob(blob, `${filePrefix()}_${pad(i + 1)}.png`);
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
    const blob = await urlToPngBlob(proxyUrl(item.url));
    await saveBlob(blob, `${filePrefix()}_${pad(indexOf(item) + 1)}.png`);
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
    $("status").textContent = `转换 PNG ${i + 1}/${items.length}…`;
    try {
      const blob = await urlToPngBlob(proxyUrl(items[i].url));
      const data = new Uint8Array(await blob.arrayBuffer());
      files.push({ name: `${filePrefix()}_${pad(i + 1)}.png`, data });
    } catch {
      failed += 1;
    }
  }

  if (!files.length) {
    setBusy(false);
    toast("全部转换失败，图片可能被站点拦截", "err");
    return;
  }

  $("status").textContent = "正在生成 ZIP…";
  const zipBlob = PicVaultZip.buildZip(files);
  try {
    await saveBlob(zipBlob, `${filePrefix()}_${stamp()}.zip`);
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

async function urlToPngBlob(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`无法读取图片（HTTP ${res.status}）`);
  const srcBlob = await res.blob();
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
  return await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 编码失败"))), "image/png");
  });
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
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
