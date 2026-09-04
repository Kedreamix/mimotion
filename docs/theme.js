(() => {
  const KEY = "mimo-theme";
  const OLD = "mimo-dongdong-theme";
  const SKIN_KEY = "mimo-skin";
  const ORDER = ["system", "light", "dark"];
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const DEFAULT_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='%2307090d'/%3E%3Ccircle cx='32' cy='32' r='22' fill='none' stroke='%23ff5a1f' stroke-width='6'/%3E%3C/svg%3E";
  const PIKA_ICON = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    + '<circle cx="32" cy="32" r="30" fill="#1a1408"/>'
    + '<path d="M18 22 L12 6 L20 18 Z" fill="#F7D948" stroke="#3a2a10" stroke-width="1.5" stroke-linejoin="round"/>'
    + '<path d="M46 22 L52 6 L44 18 Z" fill="#F7D948" stroke="#3a2a10" stroke-width="1.5" stroke-linejoin="round"/>'
    + '<path d="M12 6 L14 2 L16 8 Z" fill="#1c140a"/>'
    + '<path d="M52 6 L50 2 L48 8 Z" fill="#1c140a"/>'
    + '<circle cx="32" cy="36" r="16" fill="#F7D948" stroke="#3a2a10" stroke-width="1.6"/>'
    + '<circle cx="22" cy="40" r="4.2" fill="#E3350D"/>'
    + '<circle cx="42" cy="40" r="4.2" fill="#E3350D"/>'
    + '<circle cx="27" cy="34" r="2.1" fill="#1c140a"/>'
    + '<circle cx="37" cy="34" r="2.1" fill="#1c140a"/>'
    + '<path d="M29 44 Q32 47 35 44" fill="none" stroke="#1c140a" stroke-width="1.6" stroke-linecap="round"/>'
    + '<path d="M46 28 L54 22 L50 30 Z" fill="#FFCB05" stroke="#3a2a10" stroke-width="1"/>'
    + "</svg>",
  );

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

  function setIcon(href) {
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = href;
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
    setIcon(skin ? PIKA_ICON : DEFAULT_ICON);
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
