export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTerminalServer } = await import("./lib/terminal-server");
    startTerminalServer();
  }
}
