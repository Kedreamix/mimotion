(() => {
  const host = location.hostname;
  const local = host === "127.0.0.1" || host === "localhost";
  window.MIMO_PAGES_URL = local
    ? `${location.origin}/`
    : "https://kedreamix.github.io/mimotion/";
  window.MIMO_GUEST_API = local
    ? "http://127.0.0.1:8787"
    : "";
})();
