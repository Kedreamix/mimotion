(() => {
  const host = location.hostname;
  const pages = "https://kedreamix.github.io/mimotion";
  window.MIMO_PAGES_URL = `${pages}/`;
  window.MIMO_GUEST_API = (host === "127.0.0.1" || host === "localhost")
    ? "http://127.0.0.1:8787"
    : "";
})();
