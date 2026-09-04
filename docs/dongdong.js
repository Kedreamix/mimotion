(() => {
  const KEY = "mimo-dongdong-theme";
  const RING = 2 * Math.PI * 58;
  const REQUEST_MS = 20000;
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

  function showResult(kind, title, detail) {
    $("receipt").hidden = true;
    $("form").hidden = false;
    const el = $("result");
    el.hidden = false;
    el.className = "result " + kind;
    $("result-title").textContent = title;
    $("result-detail").textContent = detail || "";
    document.querySelector(".watch").classList.toggle("done", false);
    document.querySelector(".pass").classList.remove("arrived");
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function beijingStamp() {
    const bj = new Date(Date.now() + 8 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}`;
  }

  function showReceipt({ step, user }) {
    $("form").hidden = true;
    $("result").hidden = true;
    $("receipt").hidden = false;
    $("receipt-step").textContent = format(step);
    $("receipt-user").textContent = user || "已提交";
    $("receipt-time").textContent = `${beijingStamp()} · 北京时间`;
    $("mood").textContent = "到了";
    document.querySelector(".watch").classList.add("done");
    document.querySelector(".pass").classList.add("arrived");
    document.querySelector(".stub span:first-child").textContent = "已盖章";
    $("receipt").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  $("again").addEventListener("click", () => {
    $("receipt").hidden = true;
    $("form").hidden = false;
    $("result").hidden = true;
    $("password").value = "";
    $("password").focus();
    $("mood").textContent = mood(Number($("step").value));
    document.querySelector(".watch").classList.remove("done");
    document.querySelector(".pass").classList.remove("arrived");
    document.querySelector(".stub span:first-child").textContent = "今日通行条";
  });

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

  function abortAfter(ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return { signal: ctrl.signal, cancel: () => clearTimeout(timer) };
  }

  $("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const user = ($("user").value || "").trim();
    const password = $("password").value || "";
    const value = setStep($("step").value);
    if (!user || !password) {
      showResult("bad", "还没出发", "先填自己的账号和密码。");
      return;
    }
    const endpoint = window.MIMO_GUEST_API;
    if (!endpoint) {
      showResult("bad", "没走成", "这一趟暂时走不了。");
      return;
    }
    const button = $("submit");
    button.disabled = true;
    button.textContent = "在路上…";
    showResult("wait", "还在路上，还没成功", `正在把 ${format(value)} 步送给 Zepp，大约几秒。变成「这一趟到了」的回执才算成功。`);
    const wait = abortAfter(REQUEST_MS);
    try {
      const res = await fetch(`${endpoint.replace(/\/$/, "")}/guest-run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user,
          password,
          step: value,
          min_step: value,
          max_step: value,
        }),
        signal: wait.signal,
      });
      const body = await res.json().catch(() => ({}));
      $("password").value = "";
      if (!res.ok || !body.ok) {
        showResult("bad", "没走成", body.error || `接口返回 ${res.status}`);
        return;
      }
      const step = Number(body.step);
      setStep(step);
      showReceipt({ step, user: body.user });
    } catch (err) {
      $("password").value = "";
      const msg = String(err.message || err);
      if (err.name === "AbortError" || msg.includes("aborted")) {
        showResult("bad", "没走成", "等了 20 秒华米还没回。这趟没有刷上，请再点一次。");
      } else if (msg.includes("Failed to fetch") || msg.includes("Load failed")) {
        showResult("bad", "没走成", "连不上刷步接口，稍后再试。");
      } else {
        showResult("bad", "没走成", msg);
      }
    } finally {
      wait.cancel();
      button.disabled = false;
      button.innerHTML = "走这一趟 <span>→</span>";
    }
  });
})();
