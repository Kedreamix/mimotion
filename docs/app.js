(() => {
  const DEFAULT = { owner: "Kedreamix", repo: "mimotion" };
  const RING = 2 * Math.PI * 92;
  const DEFAULT_STEP_GOAL = 25000;
  let stepGoal = DEFAULT_STEP_GOAL;

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

  function parseHoursBlock(block) {
    const match = String(block || "").match(/北京时间:\s*'(\d+)\s+([\d,]+)/);
    if (!match) return { minute: 0, hours: [] };
    return {
      minute: Number(match[1]),
      hours: match[2].split(",").map((h) => Number(h)).filter((n) => !Number.isNaN(n)),
    };
  }

  function unionHours(...lists) {
    const set = new Set();
    lists.forEach((list) => {
      (list || []).forEach((n) => {
        if (Number.isFinite(n)) set.add(Number(n));
      });
    });
    return [...set].sort((a, b) => a - b);
  }

  function applyParams(params) {
    const max = Number(params && params.MAX_STEP);
    const min = Number(params && params.MIN_STEP);
    if (Number.isFinite(max) && max > 0) {
      stepGoal = max;
      const maxInput = document.getElementById("op-max");
      if (maxInput && !maxInput.value) maxInput.value = String(max);
    }
    if (Number.isFinite(min) && min > 0) {
      const minInput = document.getElementById("op-min");
      if (minInput && !minInput.value) minInput.value = String(min);
    }
  }

  function parseCronFile(text) {
    const [meta, stateRaw] = String(text || "").split("---STEP_STATE---");
    const sync = (meta.match(/北京时间:\s*([\d-]+ [\d:]+)/) || [])[1] || "";
    const nextExec = meta.match(/北京时间\((\d+):(\d+)\)/);
    const current = parseHoursBlock((meta.split("current cron:")[1] || "").split("next cron:")[0]);
    const next = parseHoursBlock(meta.split("next cron:")[1] || "");
    let state = {};
    try {
      state = JSON.parse((stateRaw || "{}").trim() || "{}");
    } catch {
      state = {};
    }
    const accounts = Object.values(state);
    const last = accounts.slice().sort((a, b) => String(b.last_step_date || "").localeCompare(String(a.last_step_date || "")))[0] || {};
    return {
      lastSyncText: sync,
      nextHour: nextExec ? Number(nextExec[1]) : null,
      nextMinute: nextExec ? Number(nextExec[2]) : (next.minute || current.minute || 0),
      hours: unionHours(current.hours, next.hours),
      minute: next.minute || current.minute || 0,
      lastStep: Number(last.last_step || 0),
      lastStepDate: last.last_step_date || "",
      accountCount: accounts.length,
    };
  }

  function setRing(step) {
    const ratio = Math.max(0, Math.min(1, step / stepGoal));
    $("ring-value").style.strokeDasharray = String(RING);
    $("ring-value").style.strokeDashoffset = String(RING * (1 - ratio));
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
    card.className = "status-card " + (ok ? "ok" : failed ? "bad" : "warn");
    $("status-text").textContent = ok ? "运行正常" : failed ? "最近失败" : "状态未知";
    $("status-detail").textContent = latest
      ? `最近一次刷步：${formatBJ(latest.updated_at || latest.created_at)} · ${latest.event === "schedule" ? "定时" : "手动"}`
      : "还没有刷步工作流记录";

    $("last-step").textContent = cron.lastStep ? cron.lastStep.toLocaleString("zh-CN") : "—";
    $("step-date").textContent = cron.lastStepDate
      ? `${cron.lastStepDate === todayBJ() ? "今日" : cron.lastStepDate} · 目标 ${stepGoal.toLocaleString("zh-CN")}`
      : "暂无步数记录";
    setRing(cron.lastStep || 0);

    $("last-sync").textContent = cron.lastSyncText ? cron.lastSyncText.slice(-8) : (latest ? formatBJ(latest.updated_at).slice(-5) : "—");
    $("last-sync-rel").textContent = latest ? relFromNow(latest.updated_at || latest.created_at) : "";
    $("next-run").textContent = cron.nextHour == null ? "—" : `${pad(cron.nextHour)}:${pad(cron.nextMinute)}`;
    $("account-count").textContent = cron.accountCount ? `${cron.accountCount} 个` : "—";

    if (cron.nextHour != null) {
      const remain = minutesUntil(cron.nextHour, cron.nextMinute);
      $("next-run-rel").textContent = remain < 60 ? `约 ${remain} 分钟后` : `约 ${Math.max(1, Math.round(remain / 60))} 小时后`;
    }

    const today = todayBJ();
    const todayRuns = stepRuns.filter((r) => formatBJ(r.created_at).startsWith(today));
    const success = todayRuns.filter((r) => r.conclusion === "success").length;
    $("today-count").textContent = `${success}/${Math.max(todayRuns.length, cron.hours.length || 0)}`;
    $("today-rate").textContent = todayRuns.length ? `${Math.round((success / todayRuns.length) * 100)}% 成功` : "今天还没跑完";
    $("cron-caption").textContent = cron.hours.length
      ? `计划整点 ${cron.hours.map((h) => `${h}:00`).join(" / ")}，分钟随机为 ${pad(cron.minute)}`
      : "尚未读到 cron 计划";

    renderTimeline(cron, stepRuns);
    renderRuns(runs.slice(0, 12));
  }

  function relFromNow(date) {
    const min = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000));
    if (min < 1) return "刚刚";
    if (min < 60) return `${min} 分钟前`;
    const hour = Math.round(min / 60);
    if (hour < 24) return `${hour} 小时前`;
    return `${Math.round(hour / 24)} 天前`;
  }

  function renderTimeline(cron, stepRuns) {
    const hours = cron.hours.length ? cron.hours : [9, 12, 15, 18, 22];
    const nowH = beijingParts().h;
    const today = todayBJ();
    $("timeline").innerHTML = hours.map((hour) => {
      const hit = stepRuns.find((r) => {
        const stamp = formatBJ(r.created_at);
        return stamp.startsWith(today) && Number(stamp.slice(11, 13)) === hour;
      });
      let cls = "";
      let tag = "待执行";
      if (hit && hit.conclusion === "success") {
        cls = "done";
        tag = "已完成";
      } else if (hit && hit.conclusion === "failure") {
        cls = "miss";
        tag = "失败";
      } else if (hour === cron.nextHour) {
        cls = "next";
        tag = "下一次";
      } else if (hour < nowH) {
        cls = "miss";
        tag = "已过点";
      }
      return `<li class="${cls}"><span class="hour">${pad(hour)}:${pad(cron.minute || 0)}</span><span class="tag">${tag}</span></li>`;
    }).join("");
  }

  function renderRuns(runs) {
    if (!runs.length) {
      $("runs").innerHTML = "<li>暂时没有公开的工作流记录。</li>";
      return;
    }
    $("runs").innerHTML = runs.map((r) => {
      const cls = r.conclusion === "success" ? "success" : r.conclusion === "failure" ? "failure" : "";
      const event = r.event === "schedule" ? "定时" : r.event === "workflow_dispatch" ? "手动" : r.event === "workflow_run" ? "联动" : r.event;
      const state = r.conclusion === "success" ? "成功" : r.conclusion === "failure" ? "失败" : (r.status || "进行中");
      return `<li class="${cls}">
        <span class="dot"></span>
        <div>
          <div class="name">${r.name || "workflow"} · ${state}</div>
          <div class="meta">${event} · #${r.run_number || "-"}</div>
        </div>
        <time>${formatBJ(r.updated_at || r.created_at)}</time>
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
      const cron = parseCronFile(data.cronText || "");
      renderStatus(cron, data.runs || []);
      if (usedSnapshot) {
        $("status-detail").textContent = "实时接口暂不可用，正在显示最近一次 Pages 快照";
      }
    } catch (err) {
      $("status-card").className = "status-card bad";
      $("status-text").textContent = "读取失败";
      $("status-detail").textContent = String(err.message || err);
    } finally {
      $("refresh").disabled = false;
    }
  }

  $("refresh").addEventListener("click", refresh);
  $("clock").textContent = (() => {
    const p = beijingParts();
    return `${pad(p.h)}:${pad(p.min)}:${pad(p.s)}`;
  })();
  setInterval(() => {
    const p = beijingParts();
    $("clock").textContent = `${pad(p.h)}:${pad(p.min)}:${pad(p.s)}`;
  }, 1000);

  const api = window.MimoApi;
  $("run-workflow-link").href = `${htmlBase}/actions/workflows/run.yml`;
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

  async function dispatchRun(token) {
    const { min, max } = stepInputs();
    const inputs = {};
    if (min) inputs.min_step = min;
    if (max) inputs.max_step = max;
    await api.dispatchWorkflow(token, "run.yml", inputs);
  }

  $("run-now").addEventListener("click", async () => {
    const token = requirePat("马上刷步");
    if (!token) return;
    try {
      await dispatchRun(token);
      showOps("已触发马上刷步，几秒后刷新看板可看到新记录。", true);
    } catch (err) {
      showOps(String(err.message || err), false);
    }
  });

  $("save-steps").addEventListener("click", async () => {
    const token = requirePat("保存步数范围");
    if (!token) return;
    const { min, max } = stepInputs();
    if (!min && !max) {
      showOps("请先填写最小或最大步数。", false);
      return;
    }
    try {
      if (min) await api.setVariable(token, "MIN_STEP", min);
      if (max) await api.setVariable(token, "MAX_STEP", max);
      showOps("已保存步数范围到仓库变量。", true);
    } catch (err) {
      showOps(String(err.message || err), false);
    }
  });

  $("save-and-run").addEventListener("click", async () => {
    const token = requirePat("保存并刷步");
    if (!token) return;
    const { min, max } = stepInputs();
    try {
      if (min) await api.setVariable(token, "MIN_STEP", min);
      if (max) await api.setVariable(token, "MAX_STEP", max);
      await dispatchRun(token);
      showOps("已保存步数范围并触发马上刷步。", true);
    } catch (err) {
      showOps(String(err.message || err), false);
    }
  });

  $("apply-cron").addEventListener("click", async () => {
    const token = requirePat("应用新定时");
    if (!token) return;
    try {
      await api.dispatchWorkflow(token, "cron.yml", {});
      showOps("已触发 Random Cron，会按 CRON_HOURS 换上下一次整点。", true);
    } catch (err) {
      showOps(String(err.message || err), false);
    }
  });

  $("refresh-pages").addEventListener("click", async () => {
    const token = requirePat("刷新看板");
    if (!token) return;
    try {
      await api.dispatchWorkflow(token, "pages.yml", {});
      showOps("已触发看板重新发布，大约半分钟后刷新页面。", true);
    } catch (err) {
      showOps(String(err.message || err), false);
    }
  });

  refresh();
})();
