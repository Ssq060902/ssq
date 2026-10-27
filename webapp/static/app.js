(() => {
  const form = document.getElementById("form");
  const urlInput = document.getElementById("url");
  const btn = document.getElementById("btn");
  const err = document.getElementById("err");
  const loading = document.getElementById("loading");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!/^https?:\/\//i.test(url)) {
      showErr("请输入 http/https 开头的商品链接");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "抓取失败");
      location.href = `/gallery.html?job=${encodeURIComponent(data.jobId)}`;
    } catch (err2) {
      showErr(String(err2?.message || err2));
      setBusy(false);
    }
  });

  function setBusy(busy) {
    btn.disabled = busy;
    btn.textContent = busy ? "采集中…" : "采集图片";
    loading.hidden = !busy;
    err.hidden = true;
  }

  function showErr(msg) {
    err.textContent = msg;
    err.hidden = false;
  }
})();
