(() => {
  const nav = document.querySelector(".nav");
  if (!nav) return;

  const onScroll = () => {
    nav.classList.toggle("scrolled", window.scrollY > 8);
  };

  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // Reveal platform names with a light stagger on first view
  const list = document.querySelector(".platform-list");
  if (list && "IntersectionObserver" in window) {
    const items = [...list.children];
    items.forEach((el, i) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(10px)";
      el.style.transition = `opacity 0.45s ease ${i * 0.05}s, transform 0.45s ease ${i * 0.05}s, color 0.25s ease`;
    });

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          items.forEach((el) => {
            el.style.opacity = "";
            el.style.transform = "";
          });
          io.disconnect();
        });
      },
      { threshold: 0.25 }
    );
    io.observe(list);
  }
})();
