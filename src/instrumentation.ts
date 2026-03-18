export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    process.env.PROQ_API = `http://localhost:${process.env.PORT || 1337}`;
    const { startWsServer } = await import("./lib/ws-server");
    startWsServer();
  }
}
