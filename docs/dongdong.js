(() => {
  const KEY = "mimo-dongdong-theme";
  const RING = 2 * Math.PI * 58;
  const $ = (id) => document.getElementById(id);
  const PRESETS = [3000, 8000, 12000, 20000, 30000];

  function applyTheme(mode) {
    document.documentElement.dataset.theme = mode;
    document.querySelector('meta[name="theme-color"]').setAttribute(
      "content",
      mode === "light" ? "#efe7db" : "#07090d",
    );
    $("theme-btn").textContent = mode === "light" ? "深色" : "浅色";
  }
  applyTheme(localStorage.getItem(KEY) === "light" ? "light" : "dark");
  $("theme-btn").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    localStorage.setItem(KEY, next);
    applyTheme(next);
  });

  function format(n) {
    return Number(n).toLocaleString("zh-CN");
  }

  function mood(n) {
    if (n < 3000) return "还在被窝";
    if (n < 8000) return "出门溜达";
    if (n < 12000) return "正常人类";
    if (n < 20000) return "有点猛";
    if (n < 30000) return "暴走中";
    return "今天飞了";
  }

  function describe(n) {
    const km = (n * 0.0007).toFixed(1);
    const laps = Math.max(1, Math.round(n / 570));
    return `大约 ${km} 公里 · 操场 ${laps} 圈`;
  }

  function markChip(n) {
    document.querySelectorAll("#chips button").forEach((btn) => {
      btn.classList.toggle("on", Number(btn.dataset.step) === n);
    });
  }

  function setStep(value) {
    const n = Math.max(1, Math.min(98800, Math.floor(Number(value) || 1)));
    $("step").value = String(n);
    $("slider").value = String(n);
    $("step-display").textContent = format(n);
    $("distance").textContent = describe(n);
    $("mood").textContent = mood(n);
    $("pass-no").textContent = `#${n}`;
    const ring = $("ring");
    ring.style.strokeDasharray = String(RING);
    ring.style.strokeDashoffset = String(RING * (1 - n / 98800));
    markChip(PRESETS.includes(n) ? n : 0);
    return n;
  }

  $("step").addEventListener("input", () => setStep($("step").value));
  $("slider").addEventListener("input", () => setStep($("slider").value));
  $("chips").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-step]");
    if (btn) setStep(btn.dataset.step);
  });
  setStep(20000);

  function show(text, ok, arrived) {
    const el = $("status");
    el.hidden = false;
    el.className = "status " + (ok ? "ok" : "bad");
    el.textContent = text;
    document.querySelector(".watch").classList.toggle("done", Boolean(arrived));
  }

  async function ping() {
    const live = $("api-live");
    const endpoint = window.MIMO_GUEST_API;
    if (!endpoint) {
      live.textContent = "接口离线";
      live.classList.add("off");
      return;
    }
    try {
      const res = await fetch(`${endpoint.replace(/\/$/, "")}/health`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error();
      live.textContent = "接口在线";
      live.classList.remove("off");
    } catch {
      live.textContent = "接口离线";
      live.classList.add("off");
    }
  }
  ping();

  $("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const user = ($("user").value || "").trim();
    const password = $("password").value || "";
    const value = setStep($("step").value);
    if (!user || !password) {
      show("先填自己的账号和密码。", false);
      return;
    }
    const endpoint = window.MIMO_GUEST_API;
    if (!endpoint) {
      show("这一趟暂时走不了。", false);
      return;
    }
    const button = $("submit");
    button.disabled = true;
    button.textContent = "在路上…";
    show("正在把今天的步数送出去…", true);
    try {
      const res = await fetch(`${endpoint.replace(/\/$/, "")}/guest-run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user, password, step: value }),
      });
      const body = await res.json().catch(() => ({}));
      $("password").value = "";
      if (!res.ok || !body.ok) {
        show(body.error || `没走成（${res.status}）`, false);
        return;
      }
      show(body.message || `这一趟到了，${Number(body.step).toLocaleString("zh-CN")} 步`, true, true);
    } catch (err) {
      $("password").value = "";
      const msg = String(err.message || err);
      show(msg.includes("Failed to fetch") || msg.includes("Load failed")
        ? "这一趟暂时走不了，稍后再试。"
        : msg, false);
    } finally {
      button.disabled = false;
      button.innerHTML = "走这一趟 <span>→</span>";
    }
  });
})();
