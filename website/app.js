/* PicGrab · 电商图片采集助手 —— 核心逻辑
   流程：URL -> CORS 代理抓 HTML -> 解析图片地址 -> 画廊展示 -> PNG/ZIP 下载 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const grid = $('grid'), selInfo = $('selInfo'), totalInfo = $('totalInfo');
  const toastEl = $('toast');

  /* ---------- 工具 ---------- */
  let toastTimer;
  function toast(msg, ms = 2600) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), ms);
  }
  function setProgress(text, ratio) {
    const wrap = $('progressWrap');
    if (text === null) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    $('progressText').textContent = text;
    $('progressBar').style.width = Math.round(ratio * 100) + '%';
  }
  const PROXIES = [
    (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    (u) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u),
    (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u)
  ];
  async function fetchWithTimeout(url, ms = 20000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try { return await fetch(url, { signal: ctrl.signal }); }
    finally { clearTimeout(t); }
  }
  // 依次尝试：直连 -> 代理链
  async function fetchResource(url, asBlob) {
    try { const r = await fetchWithTimeout(url, 12000); if (r.ok) return asBlob ? await r.blob() : await r.text(); } catch (e) {}
    for (const proxy of PROXIES) {
      try {
        const r = await fetchWithTimeout(proxy(url), 25000);
        if (r.ok) return asBlob ? await r.blob() : await r.text();
      } catch (e) {}
    }
    throw new Error('无法获取：' + url.slice(0, 80));
  }

  /* ---------- 采集 ---------- */
  let items = [];                 // {url}
  const checked = new Set();

  function extractImages(html, pageUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const found = new Map();
    const abs = (u) => {
      if (!u) return null;
      u = u.trim();
      if (u.startsWith('//')) u = 'https:' + u;
      if (u.startsWith('data:') || u.startsWith('blob:')) return null;
      try { const a = new URL(u, pageUrl); return /^https?:$/.test(a.protocol) ? a.href : null; }
      catch (e) { return null; }
    };
    const add = (u) => {
      u = abs(u);
      if (!u || /\.svg(\?|$)/i.test(u) || found.has(u)) return;
      found.set(u, true);
    };
    doc.querySelectorAll('img').forEach((img) => {
      add(img.getAttribute('src'));
      add(img.getAttribute('data-src'));
      add(img.getAttribute('data-original'));
      add(img.getAttribute('data-lazy-src'));
      const ss = img.getAttribute('srcset') || '';
      let best = null, bw = -1;
      ss.split(',').forEach((p) => {
        const seg = p.trim().split(/\s+/);
        const w = seg[1] ? parseFloat(seg[1]) : 0;
        if (seg[0] && w > bw) { best = seg[0]; bw = w; }
      });
      add(best);
    });
    doc.querySelectorAll('picture source').forEach((s) => add((s.getAttribute('srcset') || '').split(/\s+/)[0]));
    const og = doc.querySelector('meta[property="og:image"]');
    if (og) add(og.getAttribute('content'));
    return [...found.keys()].slice(0, 300);
  }

  async function grab() {
    const input = $('pageUrl');
    const url = input.value.trim();
    if (!/^https?:\/\/.+\..+/i.test(url)) { toast('请输入有效的商品详情页链接（http/https）'); input.focus(); return; }
    const btn = $('btnGrab');
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '采集中…';
    $('grabHint').textContent = '正在抓取页面，约需几秒到十几秒，请稍候…';
    try {
      const html = await fetchResource(url, false);
      const urls = extractImages(html, url);
      if (!urls.length) {
        $('result').classList.remove('hidden');
        $('emptyBox').classList.remove('hidden');
        grid.innerHTML = '';
        items = []; checked.clear(); updateInfo();
        toast('该页面未解析到图片，可能需要登录或为纯动态渲染');
        return;
      }
      items = urls.map((u) => ({ url: u }));
      checked.clear();
      items.forEach((_, i) => checked.add(i));   // 默认全选
      render();
      $('result').classList.remove('hidden');
      $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast(`采集完成，共 ${items.length} 张图片`);
    } catch (e) {
      toast('采集失败：页面无法访问或跨域受限，请换一个链接重试');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
      $('grabHint').textContent = '支持淘宝 / 京东 / 亚马逊等商品页 · 无需安装任何插件 · 免费使用';
    }
  }

  /* ---------- 画廊渲染 ---------- */
  function render() {
    grid.innerHTML = '';
    items.forEach((item, i) => {
      const card = document.createElement('div');
      card.className = 'card' + (checked.has(i) ? ' checked' : '');
      card.innerHTML = `
        <div class="thumb"><img loading="lazy" referrerpolicy="no-referrer" alt=""><span class="size">…</span></div>
        <div class="meta">
          <input type="checkbox" ${checked.has(i) ? 'checked' : ''}>
          <span class="name">图片 ${String(i + 1).padStart(2, '0')}</span>
          <button class="dl">PNG</button>
        </div>`;
      const img = card.querySelector('img');
      img.src = item.url;
      img.onerror = () => { card.remove(); checked.delete(i); updateInfo(); };
      img.onload = () => {
        card.querySelector('.size').textContent = `${img.naturalWidth}×${img.naturalHeight}`;
        if (img.naturalWidth < 60) { card.remove(); checked.delete(i); updateInfo(); } // 过滤小图标
      };
      card.querySelector('input').addEventListener('change', (e) => {
        e.target.checked ? checked.add(i) : checked.delete(i);
        card.classList.toggle('checked', e.target.checked);
        updateInfo();
      });
      card.querySelector('.thumb').addEventListener('click', () => {
        const cb = card.querySelector('input');
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      });
      card.querySelector('.dl').addEventListener('click', async (e) => {
        const b = e.target;
        b.textContent = '…';
        try {
          const blob = await toPngBlob(item.url);
          downloadBlob(blob, `picgrab_${String(i + 1).padStart(2, '0')}.png`);
          toast('已开始下载 PNG');
        } catch (err) { toast('下载失败：' + err.message); }
        b.textContent = 'PNG';
      });
      grid.appendChild(card);
    });
    $('emptyBox').classList.toggle('hidden', items.length > 0);
    updateInfo();
  }
  function updateInfo() {
    totalInfo.textContent = `共 ${grid.querySelectorAll('.card').length} 张`;
    selInfo.textContent = `已选 ${checked.size} 张`;
  }

  /* ---------- 下载 ---------- */
  async function toPngBlob(url) {
    const blob = await fetchResource(url, true);
    if (blob.type === 'image/png') return blob;
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width; canvas.height = bmp.height;
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    return new Promise((res, rej) =>
      canvas.toBlob((b) => b ? res(b) : rej(new Error('PNG 编码失败')), 'image/png'));
  }
  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  $('btnPng').addEventListener('click', async () => {
    if (!checked.size) return toast('请先勾选图片');
    const idx = [...checked].sort((a, b) => a - b);
    let ok = 0;
    for (let n = 0; n < idx.length; n++) {
      setProgress(`正在转换 PNG（${n + 1}/${idx.length}）…`, (n + 1) / idx.length);
      try {
        downloadBlob(await toPngBlob(items[idx[n]].url), `picgrab_${String(idx[n] + 1).padStart(2, '0')}.png`);
        ok++;
      } catch (e) { console.warn(e); }
      await new Promise((r) => setTimeout(r, 250)); // 避免浏览器拦截连续下载
    }
    setProgress(null);
    toast(`完成：成功 ${ok} 张 / 共 ${idx.length} 张`);
  });

  $('btnZip').addEventListener('click', async () => {
    if (!checked.size) return toast('请先勾选图片');
    const idx = [...checked].sort((a, b) => a - b);
    const zip = new JSZip();
    let ok = 0, fail = 0;
    for (let n = 0; n < idx.length; n++) {
      setProgress(`正在打包（${n + 1}/${idx.length}）…`, (n + 1) / (idx.length + 1));
      try {
        zip.file(`${String(n + 1).padStart(2, '0')}.png`, await toPngBlob(items[idx[n]].url));
        ok++;
      } catch (e) { fail++; console.warn(e); }
    }
    setProgress('正在压缩 ZIP…', 0.96);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    downloadBlob(blob, `picgrab_${idx.length}张_${new Date().toISOString().slice(0, 10)}.zip`);
    setProgress(null);
    toast(`ZIP 已生成：成功 ${ok} 张${fail ? '，失败 ' + fail + ' 张' : ''}`);
  });

  /* ---------- 其他交互 ---------- */
  $('btnGrab').addEventListener('click', grab);
  $('pageUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') grab(); });
  $('btnAll').addEventListener('click', () => {
    grid.querySelectorAll('.card').forEach((c) => {
      const i = items.findIndex((it) => c.querySelector('img').src === it.url);
      if (i >= 0) checked.add(i);
      c.classList.add('checked');
      c.querySelector('input').checked = true;
    });
    updateInfo();
  });
  $('btnClear').addEventListener('click', () => {
    checked.clear();
    grid.querySelectorAll('.card').forEach((c) => { c.classList.remove('checked'); c.querySelector('input').checked = false; });
    updateInfo();
  });

  // 进入视口淡入
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => es.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }), { threshold: .12 });
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
  }
})();
