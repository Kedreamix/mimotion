(() => {
  const KEY = "mimo-dongdong-theme";
  const $ = (id) => document.getElementById(id);

  function systemDark() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function applyTheme(mode) {
    const resolved = mode === "system" ? (systemDark() ? "dark" : "light") : mode;
    document.documentElement.dataset.theme = resolved;
    document.querySelector('meta[name="theme-color"]').setAttribute(
      "content",
      resolved === "dark" ? "#09090b" : "#f4f4f5",
    );
    $("theme-btn").textContent = mode === "light" ? "浅色" : mode === "dark" ? "深色" : "系统";
  }

  const saved = localStorage.getItem(KEY) || "system";
  applyTheme(saved);

  $("theme-btn").addEventListener("click", () => {
    const menu = $("theme-menu");
    const open = menu.hidden;
    menu.hidden = !open;
    $("theme-btn").setAttribute("aria-expanded", String(open));
  });
  $("theme-menu").addEventListener("click", (event) => {
    const mode = event.target.dataset.theme;
    if (!mode) return;
    localStorage.setItem(KEY, mode);
    applyTheme(mode);
    $("theme-menu").hidden = true;
    $("theme-btn").setAttribute("aria-expanded", "false");
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".theme")) $("theme-menu").hidden = true;
  });

  document.querySelectorAll(".tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabs button").forEach((item) => {
        item.classList.toggle("active", item === btn);
        item.setAttribute("aria-selected", String(item === btn));
      });
      $("panel-update").hidden = btn.dataset.tab !== "update";
      $("panel-about").hidden = btn.dataset.tab !== "about";
    });
  });

  const step = $("step");
  const slider = $("slider");
  function syncStep(value) {
    const n = Math.max(1, Math.min(98800, Math.floor(Number(value) || 1)));
    step.value = String(n);
    slider.value = String(n);
  }
  step.addEventListener("input", () => syncStep(step.value));
  slider.addEventListener("input", () => syncStep(slider.value));

  function show(text, ok) {
    const el = $("status");
    el.hidden = false;
    el.className = "status " + (ok ? "ok" : "bad");
    el.textContent = text;
  }

  async function ping() {
    const live = $("api-live");
    const endpoint = window.MIMO_GUEST_API;
    if (!endpoint) {
      live.textContent = "API 离线";
      live.classList.add("off");
      return;
    }
    try {
      const res = await fetch(`${endpoint.replace(/\/$/, "")}/health`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error();
      live.textContent = "API 在线";
      live.classList.remove("off");
    } catch {
      live.textContent = "API 离线";
      live.classList.add("off");
    }
  }
  ping();

  $("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const user = ($("user").value || "").trim();
    const password = $("password").value || "";
    const value = Number(step.value);
    if (!user || !password) {
      show("请填写账号和密码。", false);
      return;
    }
    if (!Number.isFinite(value) || value < 1 || value > 98800) {
      show("步数请填 1 到 98,800。", false);
      return;
    }
    const endpoint = window.MIMO_GUEST_API;
    if (!endpoint) {
      show("刷步接口暂不可用。", false);
      return;
    }
    const button = $("submit");
    button.disabled = true;
    button.textContent = "提交中…";
    show("正在更新步数…", true);
    try {
      const res = await fetch(`${endpoint.replace(/\/$/, "")}/guest-run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user, password, step: value }),
      });
      const body = await res.json().catch(() => ({}));
      $("password").value = "";
      if (!res.ok || !body.ok) {
        show(body.error || `更新失败（${res.status}）`, false);
        return;
      }
      show(body.message || `已同步 ${body.step} 步`, true);
    } catch (err) {
      $("password").value = "";
      const msg = String(err.message || err);
      show(msg.includes("Failed to fetch") || msg.includes("Load failed")
        ? "接口暂不可用，请稍后再试。"
        : msg, false);
    } finally {
      button.disabled = false;
      button.textContent = "动动呗";
    }
  });
})();
