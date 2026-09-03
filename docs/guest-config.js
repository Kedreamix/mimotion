(() => {
  const host = location.hostname;
  window.MIMO_GUEST_API = (host === "127.0.0.1" || host === "localhost")
    ? "http://127.0.0.1:8787"
    : "https://mimotion-guest.kedreamix.workers.dev";
})();
