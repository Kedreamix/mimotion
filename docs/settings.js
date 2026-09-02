(() => {
  const DEFAULT = { owner: "Kedreamix", repo: "mimotion" };
  const PAT_KEY = "mimotion.github_pat";
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
  const htmlBase = `https://github.com/${repo.owner}/${repo.repo}`;
  const apiBase = `https://api.github.com/repos/${repo.owner}/${repo.repo}`;
  $("vars-link").href = `${htmlBase}/settings/variables/actions`;
  $("secrets-link").href = `${htmlBase}/settings/secrets/actions`;
  $("update-workflow-link").href = `${htmlBase}/actions/workflows/update-params.yml`;

  function authHeaders(token) {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };
  }

  function showStatus(text, ok) {
    const el = $("status");
    el.hidden = false;
    el.className = "banner " + (ok ? "ok" : "bad");
    el.textContent = text;
  }

  function parseHours(text) {
    return String(text || "")
      .split(",")
      .map((part) => Number(String(part).trim()))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 23);
  }

  function bjToUtc(hours) {
    return [...new Set(hours.map((h) => (h - 8 + 24) % 24))].sort((a, b) => a - b);
  }

  function utcToBj(hours) {
    return [...new Set(hours.map((h) => (h + 8) % 24))].sort((a, b) => a - b);
  }

  function fieldInput(item) {
    if (item.type === "select") {
      const opts = (item.options || []).map((opt) => `<option value="${opt}">${opt}</option>`).join("");
      return `<select name="${item.key}">${opts}</select>`;
    }
    if (item.type === "bj-hours") {
      const chips = Array.from({ length: 24 }, (_, hour) => (
        `<button type="button" class="chip" data-hour="${hour}">${String(hour).padStart(2, "0")}</button>`
      )).join("");
      return `<input type="hidden" name="${item.key}" /><div class="hours" data-for="${item.key}">${chips}</div>`;
    }
    const type = item.type === "password" ? "password" : (item.type === "number" ? "number" : "text");
    return `<input name="${item.key}" type="${type}" value="${item.default || ""}" />`;
  }

  function renderForms(schema) {
    $("tunable-form").innerHTML = (schema.tunable || []).map((item) => `
      <label class="field">${item.label}
        ${fieldInput(item)}
        <span class="muted">${item.help || ""}</span>
      </label>
    `).join("");
    $("secret-form").innerHTML = (schema.secretConfig || []).map((item) => `
      <label class="field">${item.label}
        ${fieldInput(item)}
        <span class="muted">${item.help || ""}</span>
      </label>
    `).join("");
    (schema.tunable || []).forEach((item) => {
      if (item.type === "bj-hours") setHours(item.key, parseHours(item.default));
      else if (item.default != null) {
        const input = $("tunable-form").elements[item.key];
        if (input) input.value = item.default;
      }
    });
    $("tunable-form").addEventListener("click", (event) => {
      const chip = event.target.closest(".chip");
      if (!chip) return;
      chip.classList.toggle("on");
      const wrap = chip.parentElement;
      const selected = [...wrap.querySelectorAll(".chip.on")].map((el) => Number(el.dataset.hour));
      $("tunable-form").elements[wrap.dataset.for].value = selected.sort((a, b) => a - b).join(",");
      refreshCronPreview();
    });
    updateConfigPreview();
    refreshCronPreview();
    $("secret-form").addEventListener("input", updateConfigPreview);
  }

  function refreshCronPreview() {
    const item = (schemaCache.tunable || []).find((row) => row.type === "bj-hours");
    let preview = document.getElementById("cron-preview");
    if (!preview) {
      preview = document.createElement("p");
      preview.id = "cron-preview";
      preview.className = "muted";
      $("tunable-form").after(preview);
    }
    if (!item) {
      preview.textContent = "";
      return;
    }
    const raw = ($("tunable-form").elements[item.key] || {}).value || "";
    const utc = bjToUtc(parseHours(raw));
    preview.textContent = raw
      ? `北京时间 ${parseHours(raw).map((h) => String(h).padStart(2, "0") + ":00").join(" / ")} → 写入 CRON_HOURS（UTC） ${utc.join(",")}`
      : "还没勾选执行整点，保存时会跳过 CRON_HOURS";
  }

  function setHours(key, hours) {
    const wrap = document.querySelector(`.hours[data-for="${key}"]`);
    if (!wrap) return;
    wrap.querySelectorAll(".chip").forEach((chip) => {
      chip.classList.toggle("on", hours.includes(Number(chip.dataset.hour)));
    });
    $("tunable-form").elements[key].value = hours.join(",");
  }

  function collectTunable(schema) {
    const pairs = [];
    for (const item of schema.tunable || []) {
      const raw = ($("tunable-form").elements[item.key] || {}).value || "";
      const name = item.variable || item.key;
      const value = item.type === "bj-hours" ? bjToUtc(parseHours(raw)).join(",") : String(raw).trim();
      pairs.push({ name, value, label: item.label, raw });
    }
    return pairs;
  }

  function collectConfig(schema) {
    const config = {};
    for (const item of schema.secretConfig || []) {
      config[item.key] = ($("secret-form").elements[item.key] || {}).value || "";
    }
    return config;
  }

  function updateConfigPreview() {
    $("config-preview").textContent = JSON.stringify(collectConfig(schemaCache), null, 2);
  }

  async function setVariable(token, name, value) {
    const headers = authHeaders(token);
    const encoded = encodeURIComponent(name);
    const res = await fetch(`${apiBase}/actions/variables/${encoded}`, { headers });
    if (res.status === 404) {
      const created = await fetch(`${apiBase}/actions/variables`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name, value }),
      });
      if (!created.ok) throw new Error(`${name}: ${created.status} ${await created.text()}`);
      return;
    }
    if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
    const patched = await fetch(`${apiBase}/actions/variables/${encoded}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ name, value }),
    });
    if (!patched.ok) throw new Error(`${name}: ${patched.status} ${await patched.text()}`);
  }

  async function loadVariables(token, schema) {
    const res = await fetch(`${apiBase}/actions/variables?per_page=100`, { headers: authHeaders(token) });
    if (!res.ok) throw new Error(`读取变量失败 ${res.status}`);
    const body = await res.json();
    const map = Object.fromEntries((body.variables || []).map((item) => [item.name, item.value]));
    for (const item of schema.tunable || []) {
      if (item.type === "bj-hours") {
        const utc = parseHours(map[item.variable] || "");
        if (utc.length) setHours(item.key, utcToBj(utc));
      } else if (map[item.key] != null && map[item.key] !== "") {
        const input = $("tunable-form").elements[item.key];
        if (input) input.value = map[item.key];
      }
    }
  }

  let schemaCache = { tunable: [], secretConfig: [] };

  $("pat").value = localStorage.getItem(PAT_KEY) || "";
  $("save-pat").addEventListener("click", () => {
    localStorage.setItem(PAT_KEY, $("pat").value.trim());
    showStatus("PAT 已保存在这个浏览器。", true);
  });
  $("clear-pat").addEventListener("click", () => {
    localStorage.removeItem(PAT_KEY);
    $("pat").value = "";
    showStatus("已清除本机 PAT。", true);
  });

  $("copy-vars").addEventListener("click", async () => {
    const lines = collectTunable(schemaCache)
      .map((item) => `${item.name}=${item.value}`)
      .join("\n");
    await navigator.clipboard.writeText(lines);
    showStatus("已复制变量清单。可粘贴到仓库 Variables，或对照填写。", true);
  });

  $("copy-config").addEventListener("click", async () => {
    const json = JSON.stringify(collectConfig(schemaCache), null, 2);
    await navigator.clipboard.writeText(json);
    $("config-preview").textContent = json;
    showStatus("已复制 CONFIG JSON。请更新仓库 Secret 名为 CONFIG 的值。", true);
  });

  $("save-vars").addEventListener("click", async () => {
    const token = $("pat").value.trim() || localStorage.getItem(PAT_KEY) || "";
    if (!token) {
      showStatus("还没有 PAT。请先保存在本机，或复制变量清单后去 Variables 页手动添加。", false);
      return;
    }
    try {
      const pairs = collectTunable(schemaCache).filter((item) => item.value !== "");
      for (const item of pairs) await setVariable(token, item.name, item.value);
      showStatus(`已写入 ${pairs.map((item) => item.name).join(", ")}。改定时后请手动跑 Random Cron，或等下次刷步成功。`, true);
    } catch (err) {
      showStatus(String(err.message || err) + "。PAT 需要 Variables 读写权限。", false);
    }
  });

  $("load-vars").addEventListener("click", async () => {
    const token = $("pat").value.trim() || localStorage.getItem(PAT_KEY) || "";
    if (!token) {
      showStatus("读取当前变量需要 PAT。", false);
      return;
    }
    try {
      await loadVariables(token, schemaCache);
      showStatus("已填入仓库里的当前变量。", true);
    } catch (err) {
      showStatus(String(err.message || err), false);
    }
  });

  fetch("./params.json")
    .then((res) => res.json())
    .then((schema) => {
      schemaCache = schema;
      renderForms(schema);
    })
    .catch((err) => showStatus("无法读取 params.json：" + err, false));
})();
