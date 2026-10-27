/**
 * 图匣 PicVault — 在商品详情页采集全部图片
 */

(() => {
  const MIN_SIZE = 60;
  const MAX_COLLECT = 500;

  window.__PICVAULT_PREPARE__ = preparePage;
  window.__PICVAULT_CAPTURE__ = captureAll;

  if (!window.__PICVAULT_MSG__) {
    window.__PICVAULT_MSG__ = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "PREPARE_PAGE") {
        preparePage()
          .then(() => sendResponse({ ok: true }))
          .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
        return true;
      }
      if (message?.type === "SCAN_IMAGES") {
        try {
          sendResponse({ ok: true, ...captureAll() });
        } catch (err) {
          sendResponse({ ok: false, error: String(err?.message || err) });
        }
        return false;
      }
    });
  }

  async function preparePage() {
    clickExpanders();
    await scrollToLoadLazy();
  }

  function clickExpanders() {
    const texts = /查看更多|展开|点击查看|图文详情|查看大图|查看全部|展开全部/;
    document.querySelectorAll("button, a, span, div").forEach((el) => {
      const t = (el.textContent || "").replace(/\s+/g, "").slice(0, 20);
      if (t && texts.test(t) && el.offsetParent) {
        try {
          el.click();
        } catch {
          /* ignore */
        }
      }
    });
  }

  async function scrollToLoadLazy() {
    const hosts = [
      document.scrollingElement,
      document.querySelector("#description"),
      document.querySelector("#J-detail-content"),
      document.querySelector("#detail"),
      document.querySelector(".detail-content"),
      document.querySelector(".content-detail"),
    ].filter(Boolean);

    const unique = [...new Set(hosts)];
    for (const el of unique) {
      const max = Math.min(el.scrollHeight || document.body.scrollHeight, 12000);
      for (let y = 0; y <= max; y += 700) {
        if (el === document.scrollingElement) window.scrollTo(0, y);
        else el.scrollTop = y;
        await sleep(80);
      }
    }
    window.scrollTo(0, 0);
    await sleep(200);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function captureAll() {
    const meta = getPageMeta();
    const seen = new Set();
    const images = [];

    collectFromImgs(images, seen);
    collectFromPicture(images, seen);
    collectFromBackground(images, seen);
    collectFromDataAttrs(images, seen);
    collectFromMeta(images, seen);
    collectFromJsonLd(images, seen);
    collectFromHtml(images, seen);
    collectPlatformSpecific(meta.platform, images, seen);

    images.sort((a, b) => b.score - a.score);

    return {
      meta,
      images: images.slice(0, MAX_COLLECT),
      count: Math.min(images.length, MAX_COLLECT),
    };
  }

  function getPageMeta() {
    const host = location.hostname.replace(/^www\./, "");
    const title =
      document.querySelector("meta[property='og:title']")?.content ||
      document.querySelector("h1")?.textContent?.trim() ||
      document.title ||
      "product";
    return {
      url: location.href,
      host,
      title: title.slice(0, 120),
      platform: detectPlatform(host),
    };
  }

  function detectPlatform(host) {
    if (/taobao\.com|tmall\.com|tmall\.hk/.test(host)) return "taobao";
    if (/jd\.com|jd\.hk|3\.cn/.test(host)) return "jd";
    if (/yangkeduo\.com|pinduoduo\.com/.test(host)) return "pdd";
    if (/amazon\./.test(host)) return "amazon";
    if (/1688\.com/.test(host)) return "1688";
    if (/suning\.com/.test(host)) return "suning";
    if (/douyin\.com|jinritemai\.com/.test(host)) return "douyin";
    if (/xiaohongshu\.com|xhslink\.com/.test(host)) return "xhs";
    return "generic";
  }

  function collectFromImgs(images, seen) {
    document.querySelectorAll("img").forEach((img) => {
      const source = classifyNode(img);
      [
        img.currentSrc,
        img.src,
        img.dataset?.src,
        img.dataset?.lazySrc,
        img.dataset?.original,
        img.dataset?.ksLazyload,
        img.dataset?.lazyload,
        img.dataset?.lazy,
        img.dataset?.url,
        img.getAttribute("data-lazy-img"),
        img.getAttribute("data-lazyload-src"),
        img.getAttribute("data-lazyload"),
        pickFromSrcset(img.getAttribute("srcset")),
        pickFromSrcset(img.getAttribute("data-srcset")),
      ]
        .filter(Boolean)
        .forEach((raw) => pushImage(images, seen, raw, img, source));
    });
  }

  function collectFromPicture(images, seen) {
    document.querySelectorAll("picture source").forEach((el) => {
      const raw = pickFromSrcset(el.getAttribute("srcset")) || el.getAttribute("src");
      if (raw) pushImage(images, seen, raw, el, classifyNode(el));
    });
  }

  function collectFromBackground(images, seen) {
    document.querySelectorAll("[style*='background'], [data-background], [data-bg]").forEach((el) => {
      const urls = extractCssUrls(getComputedStyle(el).backgroundImage);
      const dataBg = el.getAttribute("data-background") || el.getAttribute("data-bg");
      if (dataBg) urls.push(dataBg);
      urls.forEach((raw) => pushImage(images, seen, raw, el, classifyNode(el)));
    });
  }

  function collectFromDataAttrs(images, seen) {
    document
      .querySelectorAll("[data-src], [data-original], [data-lazy], [data-ks-lazyload], [data-lazyload], [data-url], [data-lazy-src]")
      .forEach((el) => {
        if (!el.dataset) return;
        for (const val of Object.values(el.dataset)) {
          if (typeof val === "string" && /https?:|\/\/.+/i.test(val)) {
            val.split(/[\s,]+/).forEach((p) => {
              if (/^https?:|^\/\//.test(p)) pushImage(images, seen, p, el, classifyNode(el));
            });
          }
        }
      });
  }

  function collectFromMeta(images, seen) {
    ["meta[property='og:image']", "meta[name='og:image']", "meta[property='twitter:image']", "link[rel='image_src']"].forEach(
      (sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          const raw = el.content || el.href;
          if (raw) pushImage(images, seen, raw, el, "meta", 15);
        });
      }
    );
  }

  function collectFromJsonLd(images, seen) {
    document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
      try {
        walkJson(JSON.parse(el.textContent), (v) => {
          if (typeof v === "string" && isLikelyImage(v)) pushImage(images, seen, v, el, "meta", 12);
        });
      } catch {
        /* ignore */
      }
    });
  }

  function walkJson(node, visit) {
    if (!node) return;
    if (typeof node === "string") visit(node);
    else if (Array.isArray(node)) node.forEach((n) => walkJson(n, visit));
    else if (typeof node === "object") Object.values(node).forEach((n) => walkJson(n, visit));
  }

  function collectFromHtml(images, seen) {
    const html = document.documentElement.innerHTML;
    const re = /https?:\/\/[^\s"'<>\\]+?\.(?:jpe?g|png|webp|gif)(?:\?[^\s"'<>\\]*)?/gi;
    let m;
    let n = 0;
    while ((m = re.exec(html)) && n < 400) {
      pushImage(images, seen, m[0], document.body, guessHtmlSource(m[0]), 0);
      n += 1;
    }
  }

  function guessHtmlSource(url) {
    if (/desc|detail|content/i.test(url)) return "detail";
    return "img";
  }

  function collectPlatformSpecific(platform, images, seen) {
    const add = (sel, source, bonus, pick) => {
      document.querySelectorAll(sel).forEach((img) => {
        const raw = pick ? pick(img) : img.dataset?.src || img.src;
        pushImage(images, seen, raw, img, source, bonus);
      });
    };

    if (platform === "taobao" || platform === "1688") {
      add("#J_UlThumb img, .tb-thumb img, .mainPic, .picGallery img, .detail-gallery img", "gallery", 30);
      add(".descV8-singleImage img, #description img, .content-detail img, .ke-zeroborder img", "detail", 12);
    }

    if (platform === "jd") {
      add("#spec-list img, .spec-items img, #spec-img, .main-img img", "gallery", 30, (img) => img.dataset?.url || img.dataset?.src || img.src);
      add("#J-detail-content img, .detail-content img", "detail", 12, (img) => img.dataset?.lazyload || img.dataset?.src || img.src);
    }

    if (platform === "pdd") {
      add(".goods-gallery img, .goodsDetail img, img[class*='image']", "gallery", 20);
    }

    if (platform === "amazon") {
      document.querySelectorAll("#altImages img, #imgTagWrapperId img, #landingImage, .imgTagWrapper img").forEach((img) => {
        pushImage(images, seen, img.getAttribute("data-old-hires") || img.src, img, "gallery", 30);
        try {
          const dyn = img.getAttribute("data-a-dynamic-image");
          if (dyn) Object.keys(JSON.parse(dyn)).forEach((u) => pushImage(images, seen, u, img, "gallery", 35));
        } catch {
          /* ignore */
        }
      });
    }
  }

  function classifyNode(el) {
    const node = el?.closest?.("#description, #J-detail-content, #detail, .detail-content, .content-detail, .descV8, [id*='detail']");
    if (node) return "detail";
    const gal = el?.closest?.("#J_UlThumb, .tb-thumb, #spec-list, .spec-items, #altImages, .picGallery");
    if (gal) return "gallery";
    return "img";
  }

  function pushImage(images, seen, raw, el, source, bonus = 0) {
    const upgraded = upgradeUrl(normalizeUrl(raw));
    if (!upgraded || seen.has(upgraded) || isJunkUrl(upgraded)) return;

    const rect = el?.getBoundingClientRect?.() || { width: 0, height: 0 };
    const natW = el?.naturalWidth || 0;
    const natH = el?.naturalHeight || 0;
    const w = Math.max(natW, Math.round(rect.width || 0));
    const h = Math.max(natH, Math.round(rect.height || 0));
    const sized = w >= MIN_SIZE || h >= MIN_SIZE || source === "meta" || source === "gallery" || source === "detail";

    if (!isLikelyImage(upgraded) && !sized) return;
    if (w && h && w < MIN_SIZE && h < MIN_SIZE && !["meta", "gallery", "detail"].includes(source) && !isLikelyImage(upgraded)) {
      return;
    }

    seen.add(upgraded);
    images.push({
      url: upgraded,
      thumb: upgraded,
      width: w || null,
      height: h || null,
      source,
      score: scoreImage({ w, h, source, url: upgraded }) + bonus,
      alt: (el?.alt || el?.title || "").slice(0, 80),
    });
  }

  function normalizeUrl(raw) {
    if (!raw || typeof raw !== "string") return null;
    let u = raw.trim().replace(/^['"]|['"]$/g, "");
    if (!u || u.startsWith("data:") || u.startsWith("blob:")) return null;
    if (u.startsWith("//")) u = location.protocol + u;
    if (u.startsWith("/")) {
      try {
        u = new URL(u, location.origin).href;
      } catch {
        return null;
      }
    }
    if (!/^https?:\/\//i.test(u)) return null;
    return u.split("#")[0];
  }

  function upgradeUrl(url) {
    if (!url) return null;
    let u = url;
    u = u.replace(/_\d+x\d+[a-z]*(\.(jpg|jpeg|png|webp|gif))/gi, "$1");
    u = u.replace(/\.(jpg|jpeg|png|webp)_[a-z0-9]+\./gi, ".$1.");
    u = u.replace(/_\.(jpg|jpeg|png|webp)/gi, ".$1");
    u = u.replace(/q[5-9]0(\.(jpg|jpeg|png|webp))/gi, "q100$1");
    u = u.replace(/\.avif/gi, ".jpg");
    u = u.replace(/\/s\d+x\d+_jfs\//gi, "/s800x800_jfs/");
    u = u.replace(/\/n[1-5]\//gi, "/n1/");
    u = u.replace(/!q\d+\.dpg/gi, "");
    u = u.replace(/\.dpg(\?|$)/gi, ".jpg$1");
    u = u.replace(/\?imageMogr2.*$/i, "");
    u = u.replace(/\/resize\/[^/]+/gi, "");
    u = u.replace(/\._(?:[A-Z]{1,3}\d+){1,}(?:_[A-Z]+\d+)*/g, "");
    u = u.replace(/\._AC_.*?(?=\.(jpe?g|png|webp|gif))/gi, "");
    try {
      const parsed = new URL(u);
      ["w", "h", "width", "height", "thumbnail", "thumb"].forEach((k) => parsed.searchParams.delete(k));
      u = parsed.href;
    } catch {
      /* ignore */
    }
    return u;
  }

  function isLikelyImage(url) {
    if (/\.(jpe?g|png|webp|gif|bmp|avif)(\?|$)/i.test(url)) return true;
    if (/\/jfs\//i.test(url)) return true;
    if (/img\.alicdn|alicdn\.com|360buyimg|pddpic|pinduoduo|media-amazon|ssl-images-amazon|xhscdn|sns-img/i.test(url)) {
      return true;
    }
    if (/\/img\/|\/image\/|\/images\/|\/pic\//i.test(url)) return true;
    return false;
  }

  function isJunkUrl(url) {
    return /sprite|icon|logo|avatar|emoji|blank|placeholder|loading|1x1|pixel|beacon|tracker|favicon|qrcode|qr_code|\.svg(\?|$)|data:image\/svg|googleapis\.com\/icon/i.test(
      url
    );
  }

  function scoreImage({ w, h, source, url }) {
    let s = 0;
    const area = (w || 0) * (h || 0);
    if (area > 500000) s += 50;
    else if (area > 200000) s += 35;
    else if (area > 80000) s += 20;
    else if (area > 20000) s += 10;
    if (source === "gallery") s += 25;
    if (source === "meta") s += 15;
    if (source === "detail") s += 8;
    if (source === "img") s += 5;
    if (/alicdn|360buyimg|pddpic|media-amazon|xhscdn/i.test(url)) s += 10;
    if (/avatar|logo|icon/i.test(url)) s -= 40;
    return s;
  }

  function pickFromSrcset(srcset) {
    if (!srcset) return null;
    const parts = srcset
      .split(",")
      .map((p) => p.trim().split(/\s+/)[0])
      .filter(Boolean);
    return parts[parts.length - 1] || null;
  }

  function extractCssUrls(bg) {
    if (!bg || bg === "none") return [];
    const out = [];
    const re = /url\((['"]?)(.*?)\1\)/gi;
    let m;
    while ((m = re.exec(bg))) out.push(m[2]);
    return out;
  }
})();
