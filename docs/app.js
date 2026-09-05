(() => {
  const DEFAULT = { owner: "Kedreamix", repo: "mimotion" };
  const DEFAULT_STEP_GOAL = 25000;
  let stepGoal = DEFAULT_STEP_GOAL;
  let lastHuami = null;
  const schedule = window.MimoSchedule;

  const $ = (id) => document.getElementById(id);

  function detectRepo() {
    const host = location.hostname;
    if (host.endsWith(".github.io")) {
      const owner = host.replace(".github.io", "");
      const repo = location.pathname.replace(/\/+/g, "/").split("/").filter(Boolean)[0] || owner;
      return { owner, repo };
    }
    return DEFAULT;
  }

  const repo = detectRepo();
  const apiBase = `https://api.github.com/repos/${repo.owner}/${repo.repo}`;
  const htmlBase = `https://github.com/${repo.owner}/${repo.repo}`;

  $("repo-link").href = htmlBase;
  $("actions-link").href = `${htmlBase}/actions`;
  $("workflow-link").href = `${htmlBase}/actions/workflows/run.yml`;

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function beijingParts(date = new Date()) {
    const bj = new Date(date.getTime() + 8 * 3600 * 1000);
    return {
      y: bj.getUTCFullYear(),
      m: bj.getUTCMonth() + 1,
      d: bj.getUTCDate(),
      h: bj.getUTCHours(),
      min: bj.getUTCMinutes(),
      s: bj.getUTCSeconds(),
    };
  }

  function formatBJ(date) {
    const p = beijingParts(new Date(date));
    return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.min)}`;
  }

  function todayBJ() {
    const p = beijingParts();
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  }

  function decodeBase64(b64) {
    const bin = atob(String(b64).replace(/\s/g, ""));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  }

  function applyParams(params) {
    const max = Number(params && params.MAX_STEP);
    if (Number.isFinite(max) && max > 0) stepGoal = max;
  }

  function setBar(step) {
    const ratio = Math.max(0, Math.min(1, step / stepGoal));
    $("bar-value").style.width = `${Math.round(ratio * 100)}%`;
  }

  function guestEndpoint(path) {
    const endpoint = window.MIMO_GUEST_API;
    if (!endpoint) return "";
    return `${endpoint.replace(/\/$/, "")}${path}`;
  }

  function applyHuamiSteps(today) {
    if (today && Number.isFinite(Number(today.steps))) {
      lastHuami = today;
      $("last-step").textContent = Number(today.steps).toLocaleString("zh-CN");
      setBar(Number(today.steps));
      const when = today.date === todayBJ() ? "华米当天" : (today.date || "华米");
      $("step-date").textContent = today.stale
        ? `${when} · 刚才读不到，先显示这份 · 目标 ${stepGoal.toLocaleString("zh-CN")}`
        : `${when} · 目标 ${stepGoal.toLocaleString("zh-CN")}`;
      return;
    }
    if (lastHuami) {
      $("step-date").textContent = today && today.error
        ? `华米暂时读不到：${today.error}`
        : "华米暂时读不到，仍显示刚才的数";
      return;
    }
    $("last-step").textContent = "—";
    setBar(0);
    $("step-date").textContent = today && today.error
      ? `读不到：${today.error}`
      : "暂无华米当天数据";
  }

  function applyCronLast(cron) {
    const el = $("cron-last");
    if (!el) return;
    if (!cron || !cron.lastStep) {
      el.textContent = "上次定时 — · 仓库记下的上传，不是实时";
      return;
    }
    const dateLabel = cron.lastStepDate
      ? (cron.lastStepDate === todayBJ() ? "今日" : cron.lastStepDate)
      : "";
    el.textContent = dateLabel
      ? `上次定时 ${cron.lastStep.toLocaleString("zh-CN")} · ${dateLabel} · 仓库记录，不是实时`
      : `上次定时 ${cron.lastStep.toLocaleString("zh-CN")} · 仓库记录，不是实时`;
  }

  async function loadTodaySteps(fresh) {
    const url = guestEndpoint(fresh ? "/today-steps?fresh=1" : "/today-steps");
    if (!url) return { error: "刷步接口暂不可用" };
    try {
      const res = await fetch(url, { cache: "no-store", mode: "cors" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        return { error: body.error || `读取失败（${res.status}）` };
      }
      const steps = Number(body.steps);
      if (!Number.isFinite(steps)) return { error: "华米当天步数无法解析" };
      return {
        date: body.date || "",
        steps,
        source: body.source || "huami",
        stale: Boolean(body.stale),
        warning: body.warning || "",
        fetched_at: Number(body.fetched_at) || 0,
      };
    } catch {
      return { error: "刷步接口暂时连不上" };
    }
  }

  function minutesUntil(hour, minute) {
    const now = beijingParts();
    let delta = hour * 60 + minute - (now.h * 60 + now.min);
    if (delta < 0) delta += 24 * 60;
    return delta;
  }

  function renderStatus(cron, runs) {
    const stepRuns = runs.filter((r) => r.name === "刷步数");
    const latest = stepRuns[0];
    const ok = latest && latest.conclusion === "success";
    const failed = latest && latest.conclusion === "failure";
    const card = $("status-card");
    card.className = "glance " + (ok ? "ok" : failed ? "bad" : "warn");
    $("status-text").textContent = ok ? "正常" : failed ? "失败" : "未知";
    $("status-detail").textContent = latest
      ? (latest.event === "schedule" ? "定时" : "手动")
      : "还没有刷步记录";

    applyCronLast(cron);

    $("last-sync").textContent = latest ? formatBJ(latest.updated_at || latest.created_at).slice(-5) : "—";
    $("last-sync-rel").textContent = latest ? relFromNow(latest.updated_at || latest.created_at) : "";

    const now = beijingParts();
    const slot = schedule.nextSlot(cron.liveHours, cron.liveMinute, now);
    if (slot) {
      $("next-run").textContent = `${pad(slot.hour)}:${pad(slot.minute)}`;
      const remain = minutesUntil(slot.hour, slot.minute);
      const wait = remain < 60 ? `约 ${remain} 分钟后` : `约 ${Math.max(1, Math.round(remain / 60))} 小时后`;
      $("next-run-rel").textContent = `${wait} · 仅这一次`;
    } else {
      $("next-run").textContent = "—";
      $("next-run-rel").textContent = "";
    }

    const hours = cron.plannedHours;
    $("cron-caption").textContent = hours.length
      ? `每天 ${hours.map((h) => `${h} 点`).join(" / ")} 附近走 Actions。分钟每次成功后重随；改整点、改步数到参数页。`
      : "尚未读到 cron 计划。定时刷走 GitHub Actions，改整点到参数页。";

    renderTimeline(cron, stepRuns, slot);
    renderRuns(stepRuns.slice(0, 8));
  }

  function relFromNow(date) {
    const min = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000));
    if (min < 1) return "刚刚";
    if (min < 60) return `${min} 分钟前`;
    const hour = Math.round(min / 60);
    if (hour < 24) return `${hour} 小时前`;
    return `${Math.round(hour / 24)} 天前`;
  }

  function renderTimeline(cron, stepRuns, slot) {
    const hours = cron.plannedHours.length ? cron.plannedHours : [9, 12, 15, 18, 22];
    const nowH = beijingParts().h;
    const today = todayBJ();
    $("timeline").innerHTML = hours.map((hour) => {
      const hit = stepRuns.find((r) => {
        const stamp = formatBJ(r.created_at);
        return stamp.startsWith(today) && Number(stamp.slice(11, 13)) === hour;
      });
      let cls = "";
      let tag = "";
      if (hit && hit.conclusion === "success") {
        cls = "done";
        tag = "完成";
      } else if (hit && hit.conclusion === "failure") {
        cls = "miss";
        tag = "失败";
      } else if (slot && hour === slot.hour) {
        cls = "next";
        tag = "下次";
      } else if (hour < nowH) {
        cls = "miss";
        tag = "过点";
      }
      return `<li class="${cls}"><span class="hour">${pad(hour)}</span><span class="tag">${tag || "整点"}</span></li>`;
    }).join("");
  }

  function renderRuns(runs) {
    if (!runs.length) {
      $("runs").innerHTML = "<li>暂时没有刷步记录。</li>";
      return;
    }
    $("runs").innerHTML = runs.map((r) => {
      const cls = r.conclusion === "success" ? "success" : r.conclusion === "failure" ? "failure" : "";
      const event = r.event === "schedule" ? "定时" : r.event === "workflow_dispatch" ? "手动" : r.event;
      const state = r.conclusion === "success" ? "成功" : r.conclusion === "failure" ? "失败" : (r.status || "进行中");
      return `<li class="${cls}">
        <span class="dot"></span>
        <div>
          <div class="name">${state}</div>
          <div class="meta">${event} · #${r.run_number || "-"}</div>
        </div>
        <time>${formatBJ(r.updated_at || r.created_at).slice(5)}</time>
      </li>`;
    }).join("");
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }

  async function loadSnapshot() {
    try {
      const res = await fetch("./data.json", { cache: "no-store" });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  async function loadLive() {
    const [content, runs] = await Promise.all([
      fetchJSON(`${apiBase}/contents/cron_change_time?ref=master`),
      fetchJSON(`${apiBase}/actions/runs?per_page=20`),
    ]);
    return {
      cronText: decodeBase64(content.content),
      runs: (runs.workflow_runs || []).map((r) => ({
        name: r.name,
        conclusion: r.conclusion,
        status: r.status,
        event: r.event,
        created_at: r.created_at,
        updated_at: r.updated_at,
        run_number: r.run_number,
        html_url: r.html_url,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  function latestSuccessAt(runs) {
    const latest = (runs || []).find((r) => r.name === "刷步数" && r.conclusion === "success");
    if (!latest) return 0;
    const t = new Date(latest.updated_at || latest.created_at).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  async function refresh() {
    $("refresh").disabled = true;
    try {
      const snapshot = await loadSnapshot();
      if (snapshot && snapshot.params) applyParams(snapshot.params);
      const todayPromise = loadTodaySteps(false).then((today) => {
        applyHuamiSteps(today);
        return today;
      });
      let data = snapshot;
      let usedSnapshot = false;
      try {
        data = await loadLive();
      } catch (err) {
        if (!snapshot) throw err;
        usedSnapshot = true;
      }
      const cron = schedule.parseCronFile(data.cronText || "");
      renderStatus(cron, data.runs || []);
      const today = await todayPromise;
      const runAt = latestSuccessAt(data.runs || []);
      const fetched = Number(today && today.fetched_at) || Number(lastHuami && lastHuami.fetched_at) || 0;
      if (runAt > fetched) {
        applyHuamiSteps(await loadTodaySteps(true));
      }
      if (usedSnapshot) {
        $("status-detail").textContent = "实时接口暂不可用，正在显示快照";
      }
    } catch (err) {
      $("status-card").className = "glance bad";
      $("status-text").textContent = "读取失败";
      $("status-detail").textContent = String(err.message || err);
    } finally {
      $("refresh").disabled = false;
    }
  }

  $("refresh").addEventListener("click", () => refresh());
  function tick() {
    const p = beijingParts();
    $("clock").textContent = `${pad(p.h)}:${pad(p.min)}`;
  }
  tick();
  setInterval(tick, 1000);

  function showOps(text, ok) {
    const el = $("ops-status");
    el.hidden = false;
    el.className = "banner " + (ok ? "ok" : "bad");
    el.textContent = text;
  }

  async function runOwner() {
    const password = ($("owner-pwd").value || "").trim();
    if (!password) {
      showOps("请输入站长密码。", false);
      $("owner-pwd").focus();
      return;
    }
    const endpoint = window.MIMO_GUEST_API;
    const button = $("run-now");
    button.disabled = true;
    button.innerHTML = "正在刷步…";
    showOps("正在验证密码…", true);
    try {
      if (!endpoint) throw new Error("刷步接口暂不可用。");
      const res = await fetch(`${endpoint.replace(/\/$/, "")}/owner-run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => ({}));
      $("owner-pwd").value = "";
      if (!res.ok || !body.ok) {
        showOps(body.error || `刷步失败（${res.status}）`, false);
        return;
      }
      showOps(body.message || `已同步 ${body.step} 步`, true);
      if (Number.isFinite(Number(body.step))) {
        applyHuamiSteps({
          date: todayBJ(),
          steps: Number(body.step),
          source: "huami",
          fetched_at: Date.now(),
        });
      }
    } catch (err) {
      $("owner-pwd").value = "";
      const msg = String(err.message || err);
      showOps(msg.includes("Failed to fetch") || msg.includes("Load failed")
        ? "刷步接口暂不可用，请稍后再试。"
        : msg, false);
    } finally {
      button.disabled = false;
      button.innerHTML = "马上刷步 <span>→</span>";
    }
  }

  $("run-now").addEventListener("click", runOwner);
  $("owner-pwd").addEventListener("keydown", (event) => {
    if (event.key === "Enter") runOwner();
  });

  function renderUsage(body) {
    const box = $("usage-box");
    if (!box) return;
    box.hidden = false;
    const people = Number(body.unique_users) || 0;
    const total = Number(body.total) || 0;
    $("usage-summary").textContent = `迈步 ${people} 人 · ${total} 次 · 成功 ${Number(body.ok_count) || 0} · 失败 ${Number(body.fail_count) || 0}`;
    const rows = Array.isArray(body.recent) ? body.recent : [];
    $("usage-list").innerHTML = rows.length
      ? rows.map((row) => {
        const cls = Number(row.ok) === 1 ? "ok" : "fail";
        const step = Number.isFinite(Number(row.step)) ? `${Number(row.step).toLocaleString("zh-CN")} 步` : "";
        return `<li><span>${row.user || "—"}</span><span class="${cls}">${Number(row.ok) === 1 ? "成功" : "失败"} ${step}</span></li>`;
      }).join("")
      : "<li>还没有迈步记录。</li>";
  }

  async function loadUsage() {
    const password = ($("owner-pwd").value || "").trim();
    if (!password) {
      showOps("请输入站长密码。", false);
      $("owner-pwd").focus();
      return;
    }
    const endpoint = window.MIMO_GUEST_API;
    const button = $("usage-now");
    button.disabled = true;
    try {
      if (!endpoint) throw new Error("用量接口暂不可用。");
      const res = await fetch(`${endpoint.replace(/\/$/, "")}/owner-usage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, limit: 20 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        showOps(body.error || `读取用量失败（${res.status}）`, false);
        return;
      }
      renderUsage(body);
      showOps(`迈步已记录 ${body.unique_users || 0} 人。`, true);
    } catch (err) {
      showOps(String(err.message || err), false);
    } finally {
      button.disabled = false;
    }
  }

  $("usage-now").addEventListener("click", loadUsage);

  async function checkOwnerSetup() {
    const ready = $("account-ready");
    const endpoint = window.MIMO_GUEST_API;
    if (!endpoint) return;
    try {
      const res = await fetch(`${endpoint.replace(/\/$/, "")}/owner-status`);
      if (!res.ok) return;
      const body = await res.json().catch(() => ({}));
      if (!body.configured) {
        ready.textContent = "站长刷步还没配置完成。";
      } else if (!body.hasAccount && !body.hasConfig) {
        ready.textContent = "还差 Worker 里的 CONFIG。仓库那份 JSON 即可，不用贴 PAT。";
      }
    } catch {
      /* Worker 未部署时静默忽略，用户还是可以尝试输密码 */
    }
  }

  checkOwnerSetup();
  refresh();
})();
