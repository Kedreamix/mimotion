(function (root) {
  function parseHoursBlock(block) {
    const match = String(block || "").match(/北京时间:\s*'(\d+)\s+([\d,]+)/);
    if (!match) return { minute: 0, hours: [] };
    return {
      minute: Number(match[1]),
      hours: match[2].split(",").map((h) => Number(h)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 23),
    };
  }

  function unionHours(...lists) {
    const set = new Set();
    lists.forEach((list) => {
      (list || []).forEach((n) => {
        const hour = Number(n);
        if (Number.isInteger(hour) && hour >= 0 && hour <= 23) set.add(hour);
      });
    });
    return [...set].sort((a, b) => a - b);
  }

  function nextSlot(hours, minute, now) {
    const min = Number(minute) || 0;
    const sorted = unionHours(hours);
    if (!sorted.length || !now) return null;
    for (const hour of sorted) {
      if (hour > now.h || (hour === now.h && min > now.min)) {
        return { hour, minute: min };
      }
    }
    return { hour: sorted[0], minute: min };
  }

  function parseCronFile(text) {
    const [meta, stateRaw] = String(text || "").split("---STEP_STATE---");
    const sync = (meta.match(/北京时间:\s*([\d-]+ [\d:]+)/) || [])[1] || "";
    const current = parseHoursBlock((meta.split("current cron:")[1] || "").split("next cron:")[0]);
    const next = parseHoursBlock(meta.split("next cron:")[1] || "");
    const live = next.hours.length ? next : current;
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
      current,
      next,
      plannedHours: unionHours(current.hours, next.hours),
      liveHours: live.hours,
      liveMinute: live.minute,
      lastStep: Number(last.last_step || 0),
      lastStepDate: last.last_step_date || "",
      accountCount: accounts.length,
    };
  }

  const api = {
    parseHoursBlock,
    unionHours,
    nextSlot,
    parseCronFile,
  };
  root.MimoSchedule = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
