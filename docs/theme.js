(() => {
  const KEY = "mimo-theme";
  const OLD = "mimo-dongdong-theme";
  const ORDER = ["system", "light", "dark"];
  const mq = window.matchMedia("(prefers-color-scheme: light)");

  function pref() {
    const saved = localStorage.getItem(KEY) || localStorage.getItem(OLD);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
    return "system";
  }

  function resolved(p) {
    if (p === "light" || p === "dark") return p;
    return mq.matches ? "light" : "dark";
  }

  function apply(p) {
    const mode = resolved(p);
    document.documentElement.dataset.theme = mode;
    document.documentElement.dataset.themePref = p;
    document.documentElement.style.colorScheme = mode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", mode === "light" ? "#efe7db" : "#07090d");
    const btn = document.getElementById("theme-btn");
    if (btn) {
      btn.textContent = p === "system" ? "系统" : p === "light" ? "浅色" : "深色";
      btn.title = p === "system"
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
      const cur = pref();
      const i = Math.max(0, ORDER.indexOf(cur));
      const next = ORDER[(i + 1) % ORDER.length];
      localStorage.setItem(KEY, next);
      localStorage.removeItem(OLD);
      apply(next);
    });
  }
})();
