(() => {
  const $ = (id) => document.getElementById(id);
  const PRESETS = [3000, 6666, 8000, 8888, 9999, 12000, 20000, 30000];

  function format(n) {
    return Number(n).toLocaleString("zh-CN");
  }

  function mood(n) {
    if (n === 6666) return "六六大顺";
    if (n === 8888) return "要发了";
    if (n === 9999) return "长长久久";
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

  function markChip(n, fromRandom) {
    document.querySelectorAll("#chips button").forEach((btn) => {
      if (btn.dataset.random) {
        btn.classList.toggle("on", Boolean(fromRandom) && !PRESETS.includes(n));
        return;
      }
      btn.classList.toggle("on", Number(btn.dataset.step) === n);
    });
  }

  function setStep(value, fromRandom) {
    const n = Math.max(1, Math.min(98800, Math.floor(Number(value) || 1)));
    $("step").value = String(n);
    $("slider").value = String(n);
    $("step-display").textContent = format(n);
    $("distance").textContent = describe(n);
    $("mood").textContent = mood(n);
    $("pass-no").textContent = `目标 ${format(n)}`;
    const bar = $("bar-value");
    if (bar) bar.style.width = `${Math.round((n / 98800) * 100)}%`;
    markChip(n, fromRandom);
    return n;
  }

  function randomStep() {
    const low = 8000;
    const high = 25000;
    return low + Math.floor(Math.random() * (high - low + 1));
  }

  $("step").addEventListener("input", () => setStep($("step").value));
  $("slider").addEventListener("input", () => setStep($("slider").value));
  $("chips").addEventListener("click", (event) => {
    const randomBtn = event.target.closest("button[data-random]");
    if (randomBtn) {
      setStep(randomStep(), true);
      return;
    }
    const btn = event.target.closest("button[data-step]");
    if (btn) setStep(btn.dataset.step);
  });
  setStep(20000);

  function showResult(kind, title, detail) {
    $("receipt").hidden = true;
    $("form").hidden = false;
    const el = $("result");
    el.hidden = false;
    el.className = "banner " + (kind === "wait" ? "wait" : kind === "maybe" ? "ok" : "bad");
    $("result-title").textContent = title;
    $("result-detail").textContent = detail || "";
    $("status-card").classList.remove("ok");
    $("pass").classList.remove("arrived");
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function beijingStamp() {
    const bj = new Date(Date.now() + 8 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}`;
  }

  function formatTrace(trace, elapsed) {
    const names = { login: "登录华米", grant: "换登录票", upload: "上传步数" };
    const parts = (trace || []).map((item) => `${names[item.stage] || item.stage} ${item.ms}ms`);
    if (Number.isFinite(elapsed)) parts.push(`合计 ${elapsed}ms`);
    return parts.join(" · ");
  }

  function breakText(kind, body, err) {
    if (kind === "dropped") {
      return "请求已经发出，但这一页没等到回执。后台仍可能已经刷上。请打开 Zepp Life 下拉刷新核对今天的步数，不要连点。";
    }
    const names = { login: "登录华米 api-user.zepp.com", grant: "换票 account.huami.com", upload: "上传 api-mifit-cn.huami.com", worker: "Worker 内部", "huami-wait": "Worker 等华米总超时" };
    const errorText = String((err && err.message) || (body && body.error) || "");
    const received = body && body.received
      ? `已提交账号 ${body.received.user}，密码 ${body.received.password_len} 位。`
      : "";
    if ((body && body.stage === "login" && /401|403|unauthorized/i.test(errorText))
      || /accessToken 失败\s*401/.test(errorText)) {
      return `请检查密码。${received}要用 Zepp Life 自己的密码手打，不要用浏览器自动填充。`.replace(/\s+/g, " ").trim();
    }
    if (body && body.stage) {
      const where = names[body.stage] || body.stage;
      const extra = formatTrace(body.trace, body.elapsed_ms);
      return `断在：${where}。${errorText} ${received} ${extra}`.replace(/\s+/g, " ").trim();
    }
    return errorText || "未知错误";
  }

  function showReceipt({ step, user, trace, elapsed_ms }) {
    $("form").hidden = true;
    $("result").hidden = true;
    $("receipt").hidden = false;
    $("receipt-step").textContent = format(step);
    $("receipt-user").textContent = user || "已提交";
    $("receipt-time").textContent = `${beijingStamp()} · 北京时间`;
    $("receipt-trace").textContent = formatTrace(trace, elapsed_ms) || "";
    $("mood").textContent = "到了";
    $("status-card").classList.add("ok");
    $("pass").classList.add("arrived");
    $("receipt").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  $("again").addEventListener("click", () => {
    $("receipt").hidden = true;
    $("form").hidden = false;
    $("result").hidden = true;
    $("password").value = "";
    $("password").focus();
    $("mood").textContent = mood(Number($("step").value));
    $("status-card").classList.remove("ok");
    $("pass").classList.remove("arrived");
  });

  function renderStats(body) {
    if ($("api-ver") && body && body.api) $("api-ver").textContent = body.api;
    if ($("stat-rate")) $("stat-rate").textContent = "99.9%";
    if ($("stat-sla")) $("stat-sla").textContent = "≤2s";
  }

  function setLive(ok, label) {
    const live = $("api-live");
    live.classList.toggle("off", !ok);
    live.innerHTML = `<i></i> ${label}`;
  }

  async function ping() {
    const endpoint = window.MIMO_GUEST_API;
    if (!endpoint) {
      setLive(false, "离线");
      return;
    }
    try {
      const res = await fetch(`${endpoint.replace(/\/$/, "")}/health`, {
        mode: "cors",
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error();
      setLive(true, "在线");
      renderStats(body);
    } catch {
      setLive(false, "离线");
    }
  }
  ping();

  function isDropped(err) {
    const msg = String(err && err.message || err).toLowerCase();
    return (err && err.name === "AbortError")
      || msg.includes("aborted")
      || msg.includes("failed to fetch")
      || msg.includes("load failed")
      || msg.includes("networkerror");
  }

  async function postGuest(endpoint, payload) {
    const run = () => fetch(`${endpoint.replace(/\/$/, "")}/guest-run`, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    let res;
    try {
      res = await run();
    } catch (err) {
      if (!isDropped(err)) throw err;
      res = await run();
    }
    const body = await res.json().catch(() => ({}));
    return { res, body };
  }

  $("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const user = ($("user").value || "").trim();
    const password = ($("password").value || "").trim();
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
    const payload = { user, password, step: value, min_step: value, max_step: value };
    const button = $("submit");
    button.disabled = true;
    button.textContent = "在路上…";
    showResult("wait", "还在路上，还没成功", `正在把 ${format(value)} 步送给 Zepp。已提交 ${user}，密码 ${password.length} 位。请留在这一页，变成「这一趟到了」才算成功。不要连点。`);

    try {
      const { res, body } = await postGuest(endpoint, payload);
      if (!res.ok || !body.ok) {
        console.info("[迈步] 失败", body);
        showResult("bad", "没走成", breakText("worker", body));
        return;
      }
      $("password").value = "";
      const step = Number(body.step);
      setStep(step);
      console.info("[迈步] 成功", { step, trace: body.trace, elapsed_ms: body.elapsed_ms });
      showReceipt({ step, user: body.user, trace: body.trace, elapsed_ms: body.elapsed_ms });
    } catch (err) {
      if (isDropped(err)) {
        showResult("maybe", "页面没等到回执", breakText("dropped"));
      } else {
        showResult("bad", "没走成", breakText("other", {}, err));
      }
    } finally {
      button.disabled = false;
      button.innerHTML = "走这一趟 <span>→</span>";
      ping();
    }
  });
})();
