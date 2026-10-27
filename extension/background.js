/**
 * 点击图匣：滚动加载详情图 → 采集全页图片 → 新标签页展示
 */

const JOB_KEY = "picvaultJob";

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await captureAndOpen(tab);
  } catch (err) {
    await saveJob({
      ok: false,
      loading: false,
      error: String(err?.message || err),
      meta: { title: "采集失败", url: tab?.url || "", host: "", platform: "generic" },
      images: [],
    });
    await focusViewer();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "FETCH_BYTES") {
    fetchBytes(message.url)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
});

async function captureAndOpen(tab) {
  if (!tab?.id) throw new Error("无法获取当前标签页");
  if (tab.url?.startsWith("chrome-extension://") && tab.url.includes("viewer.html")) {
    throw new Error("请先打开电商商品详情页，再点击图匣");
  }
  if (!/^https?:/i.test(tab.url || "")) {
    throw new Error("请在商品详情页（http/https）上使用图匣");
  }

  await saveJob({
    ok: true,
    loading: true,
    error: "",
    sourceTabId: tab.id,
    capturedAt: Date.now(),
    meta: { title: tab.title || "采集中", url: tab.url, host: hostname(tab.url), platform: "generic" },
    images: [],
  });
  await focusViewer();

  await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    files: ["content.js"],
  });

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async () => {
      if (typeof window.__PICVAULT_PREPARE__ === "function") {
        await window.__PICVAULT_PREPARE__();
      }
    },
  });

  const frames = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: () => (typeof window.__PICVAULT_CAPTURE__ === "function" ? window.__PICVAULT_CAPTURE__() : null),
  });

  const merged = mergeFrameResults(frames, tab);
  await saveJob({
    ok: true,
    loading: false,
    error: merged.images.length ? "" : "未采集到图片，请确认当前是商品详情页",
    sourceTabId: tab.id,
    capturedAt: Date.now(),
    meta: merged.meta,
    images: merged.images,
  });
}

function mergeFrameResults(frames, tab) {
  const seen = new Set();
  const images = [];
  let meta = {
    title: tab.title || "product",
    url: tab.url,
    host: hostname(tab.url),
    platform: "generic",
  };

  for (const frame of frames || []) {
    const r = frame?.result;
    if (!r?.images) continue;
    if (r.meta?.title && (!meta.title || meta.title === tab.title)) meta = r.meta;
    if (r.meta?.platform && r.meta.platform !== "generic") meta = { ...meta, ...r.meta };
    for (const img of r.images) {
      if (!img?.url || seen.has(img.url)) continue;
      seen.add(img.url);
      images.push(img);
    }
  }

  images.sort((a, b) => (b.score || 0) - (a.score || 0));
  return { meta, images: images.slice(0, 500) };
}

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function saveJob(job) {
  await chrome.storage.local.set({ [JOB_KEY]: job });
}

async function focusViewer() {
  const url = chrome.runtime.getURL("viewer.html");
  const tabs = await chrome.tabs.query({ url });
  if (tabs[0]?.id) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    return;
  }
  await chrome.tabs.create({ url, active: true });
}

async function fetchBytes(url) {
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, error: "无效地址" };
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) return { ok: false, error: `无法读取图片（HTTP ${res.status}）` };
  const buffer = await res.arrayBuffer();
  return { ok: true, buffer, mime: res.headers.get("content-type") || "image/jpeg" };
}
