(() => {
  const DEFAULT = { owner: "Kedreamix", repo: "mimotion" };
  const DEFAULT_STEP_GOAL = 25000;
  let stepGoal = DEFAULT_STEP_GOAL;
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
    const min = Number(params && params.MIN_STEP);
    if (Number.isFinite(max) && max > 0) {
      stepGoal = max;
      const maxInput = $("op-max");
      if (maxInput && !maxInput.value) maxInput.value = String(max);
    }
    if (Number.isFinite(min) && min > 0) {
      const minInput = $("op-min");
      if (minInput && !minInput.value) minInput.value = String(min);
    }
  }

  function setBar(step) {
    const ratio = Math.max(0, Math.min(1, step / stepGoal));
    $("bar-value").style.width = `${Math.round(ratio * 100)}%`;
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

    $("last-step").textContent = cron.lastStep ? cron.lastStep.toLocaleString("zh-CN") : "—";
    $("step-date").textContent = cron.lastStepDate
      ? `${cron.lastStepDate === todayBJ() ? "今日" : cron.lastStepDate} · 目标 ${stepGoal.toLocaleString("zh-CN")}`
      : "暂无步数记录";
    setBar(cron.lastStep || 0);

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
      ? `每天 ${hours.map((h) => `${h} 点`).join(" / ")} 附近。分钟每次成功后重随，不按同一分钟套全天。`
      : "尚未读到 cron 计划";

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

  async function refresh() {
    $("refresh").disabled = true;
    try {
      const snapshot = await loadSnapshot();
      if (snapshot && snapshot.params) applyParams(snapshot.params);
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

  $("refresh").addEventListener("click", refresh);
  function tick() {
    const p = beijingParts();
    $("clock").textContent = `${pad(p.h)}:${pad(p.min)}`;
  }
  tick();
  setInterval(tick, 1000);

  const api = window.MimoApi;
  const patInput = $("pat");
  if (patInput) patInput.value = localStorage.getItem(api.PAT_KEY) || "";

  function showOps(text, ok) {
    const el = $("ops-status");
    el.hidden = false;
    el.className = "banner " + (ok ? "ok" : "bad");
    el.textContent = text;
  }

  function stepInputs() {
    return {
      min: ($("op-min").value || "").trim(),
      max: ($("op-max").value || "").trim(),
    };
  }

  function requirePat(action) {
    const token = api.getPat();
    if (!token) {
      showOps(api.needPat(action).message, false);
      return "";
    }
    api.savePat(token);
    return token;
  }

  $("run-now").addEventListener("click", async () => {
    const token = requirePat("马上刷步");
    if (!token) return;
    try {
      const { min, max } = stepInputs();
      const inputs = {};
      if (min) inputs.min_step = min;
      if (max) inputs.max_step = max;
      await api.dispatchWorkflow(token, "run.yml", inputs);
      showOps("已触发马上刷步。", true);
    } catch (err) {
      showOps(String(err.message || err), false);
    }
  });

  refresh();
})();
