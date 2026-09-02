window.MimoApi = (() => {
  const PAT_KEY = "mimotion.github_pat";
  const DEFAULT = { owner: "Kedreamix", repo: "mimotion" };

  function detectRepo() {
    const host = location.hostname;
    if (host.endsWith(".github.io")) {
      const owner = host.replace(".github.io", "");
      const repo = location.pathname.replace(/\/+/g, "/").split("/").filter(Boolean)[0] || owner;
      return { owner, repo };
    }
    return DEFAULT;
  }

  function getPat() {
    return (document.getElementById("pat") && document.getElementById("pat").value.trim())
      || localStorage.getItem(PAT_KEY)
      || "";
  }

  function savePat(value) {
    const token = String(value || "").trim();
    if (token) localStorage.setItem(PAT_KEY, token);
    else localStorage.removeItem(PAT_KEY);
    return token;
  }

  function authHeaders(token) {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };
  }

  function apiBase() {
    const repo = detectRepo();
    return `https://api.github.com/repos/${repo.owner}/${repo.repo}`;
  }

  function htmlBase() {
    const repo = detectRepo();
    return `https://github.com/${repo.owner}/${repo.repo}`;
  }

  async function setVariable(token, name, value) {
    const encoded = encodeURIComponent(name);
    const headers = authHeaders(token);
    const res = await fetch(`${apiBase()}/actions/variables/${encoded}`, { headers });
    if (res.status === 404) {
      const created = await fetch(`${apiBase()}/actions/variables`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name, value: String(value) }),
      });
      if (!created.ok) throw new Error(`${name}: ${created.status} ${await created.text()}`);
      return;
    }
    if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
    const patched = await fetch(`${apiBase()}/actions/variables/${encoded}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ name, value: String(value) }),
    });
    if (!patched.ok) throw new Error(`${name}: ${patched.status} ${await patched.text()}`);
  }

  async function dispatchWorkflow(token, file, inputs) {
    const body = { ref: "master" };
    if (inputs && Object.keys(inputs).length) body.inputs = inputs;
    const res = await fetch(`${apiBase()}/actions/workflows/${file}/dispatches`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    if (res.status !== 204) {
      throw new Error(`${file}: ${res.status} ${await res.text()}`);
    }
  }

  function needPat(action) {
    return new Error(`还没有 PAT，无法${action}。Fine-grained 需要 Actions 读写（触发工作流）和 Variables 读写（保存步数）。`);
  }

  return {
    PAT_KEY,
    detectRepo,
    getPat,
    savePat,
    authHeaders,
    apiBase,
    htmlBase,
    setVariable,
    dispatchWorkflow,
    needPat,
  };
})();
