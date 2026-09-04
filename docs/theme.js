(() => {
  const KEY = "mimo-theme";
  const OLD = "mimo-dongdong-theme";
  const SKIN_KEY = "mimo-skin";
  const ORDER = ["system", "light", "dark"];
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const DEFAULT_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='%2307090d'/%3E%3Ccircle cx='32' cy='32' r='22' fill='none' stroke='%23ff5a1f' stroke-width='6'/%3E%3C/svg%3E";
  const PIKA_ICON = "./assets/pikachu-favicon.png";
  const PIKA_TOUCH = "./assets/pikachu-mark.png";

  function pref() {
    const saved = localStorage.getItem(KEY) || localStorage.getItem(OLD);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
    return "system";
  }

  function skinPref() {
    return localStorage.getItem(SKIN_KEY) === "pikachu" ? "pikachu" : "";
  }

  function resolved(p) {
    if (p === "light" || p === "dark") return p;
    return mq.matches ? "light" : "dark";
  }

  function setIcon(href, touchHref) {
    const ensure = (rel, extra) => {
      let link = document.querySelector(`link[rel="${rel}"]`);
      if (!link) {
        link = document.createElement("link");
        link.rel = rel;
        if (extra) Object.assign(link, extra);
        document.head.appendChild(link);
      }
      return link;
    };
    ensure("icon").type = href.endsWith(".png") ? "image/png" : "image/svg+xml";
    ensure("icon").href = href;
    const touch = ensure("apple-touch-icon");
    touch.href = touchHref || href;
    document.querySelectorAll(".logo-mark").forEach((img) => {
      img.hidden = href === DEFAULT_ICON;
      if (href !== DEFAULT_ICON) img.src = PIKA_TOUCH;
    });
  }

  function apply(p) {
    const mode = resolved(p);
    const skin = skinPref();
    const root = document.documentElement;
    root.dataset.theme = mode;
    root.dataset.themePref = p;
    if (skin) root.dataset.skin = skin;
    else delete root.dataset.skin;
    root.style.colorScheme = mode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", skin
        ? "#F7D948"
        : (mode === "light" ? "#efe7db" : "#07090d"));
    }
    setIcon(skin ? PIKA_ICON : DEFAULT_ICON, skin ? PIKA_TOUCH : DEFAULT_ICON);
    const btn = document.getElementById("theme-btn");
    if (btn) {
      btn.textContent = skin
        ? "皮卡丘"
        : (p === "system" ? "系统" : p === "light" ? "浅色" : "深色");
      btn.title = skin
        ? "隐藏皮肤已开，连点 logo 七次关闭"
        : p === "system"
          ? "跟随系统，点击改为浅色"
          : p === "light"
            ? "浅色，点击改为深色"
            : "深色，点击改为跟随系统";
    }
  }

  apply(pref());
  const onScheme = () => {
    if (pref() === "system") apply("system");
  };
  if (mq.addEventListener) mq.addEventListener("change", onScheme);
  else if (mq.addListener) mq.addListener(onScheme);
  const btn = document.getElementById("theme-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      if (skinPref()) return;
      const cur = pref();
      const i = Math.max(0, ORDER.indexOf(cur));
      const next = ORDER[(i + 1) % ORDER.length];
      localStorage.setItem(KEY, next);
      localStorage.removeItem(OLD);
      apply(next);
    });
  }

  let taps = 0;
  let tapTimer = 0;
  document.querySelectorAll(".logo").forEach((logo) => {
    logo.style.cursor = "pointer";
    logo.addEventListener("click", (event) => {
      event.preventDefault();
      taps += 1;
      clearTimeout(tapTimer);
      tapTimer = window.setTimeout(() => {
        taps = 0;
      }, 2600);
      if (taps < 7) return;
      taps = 0;
      const next = skinPref() ? "" : "pikachu";
      if (next) localStorage.setItem(SKIN_KEY, next);
      else localStorage.removeItem(SKIN_KEY);
      apply(pref());
    });
  });
})();
