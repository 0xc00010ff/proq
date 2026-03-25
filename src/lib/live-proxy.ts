import { createServer } from "http";
import type { IncomingMessage, ServerResponse } from "http";

/**
 * Standalone HTTP proxy for Live Preview URL tracking.
 *
 * Runs on its own port (WS_PORT + 1, default 42070). The iframe loads through
 * this proxy instead of directly from the dev server, which lets us inject a
 * tiny script that reports URL changes back to the parent via postMessage.
 *
 * Flow:
 *  1. LiveTab sets iframe src to  http://localhost:42070/__proq_init?target=<devServerUrl>
 *  2. Proxy sets a cookie (__proq_target) and serves the root page with the tracker injected.
 *  3. Subsequent requests from the iframe include the cookie -> proxy forwards to dev server.
 *  4. Tracker script intercepts pushState/replaceState/popstate and posts
 *     { type: "proq-live-url", url: "/current/path" } to the parent window.
 */

const TRACKER_SCRIPT = `<script>(function(){if(window.parent===window)return;function r(){window.parent.postMessage({type:"proq-live-url",url:location.pathname+location.search+location.hash},"*")}r();var p=history.pushState,s=history.replaceState;history.pushState=function(){p.apply(this,arguments);setTimeout(r,0)};history.replaceState=function(){s.apply(this,arguments);setTimeout(r,0)};window.addEventListener("popstate",r);window.addEventListener("hashchange",r)})()</script>`;

function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq > 0) result[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return result;
}

function getTarget(req: IncomingMessage): string | null {
  const raw = parseCookies(req.headers.cookie || "").__proq_target;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function forwardHeaders(req: IncomingMessage): Record<string, string> {
  const h: Record<string, string> = {};
  const skip = new Set(["host", "cookie", "connection", "upgrade", "accept-encoding"]);
  for (const [key, val] of Object.entries(req.headers)) {
    if (!skip.has(key) && typeof val === "string") h[key] = val;
  }
  return h;
}

function injectTracker(html: string): string {
  if (html.includes("</head>")) return html.replace("</head>", TRACKER_SCRIPT + "</head>");
  if (html.includes("</body>")) return html.replace("</body>", TRACKER_SCRIPT + "</body>");
  return html + TRACKER_SCRIPT;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", "http://localhost");

  // ── Init: set cookie + serve root page with tracker ──
  if (url.pathname === "/__proq_init") {
    const target = url.searchParams.get("target");
    if (!target) {
      res.writeHead(400);
      res.end("Missing target parameter");
      return;
    }
    try {
      const resp = await fetch(target.replace(/\/$/, "") + "/", {
        headers: { accept: "text/html" },
      });
      let html = await resp.text();
      html = injectTracker(html);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": `__proq_target=${encodeURIComponent(target)}; Path=/; SameSite=Lax`,
        "Cache-Control": "no-cache",
      });
      res.end(html);
    } catch (err) {
      res.writeHead(502);
      res.end(`Cannot connect to ${target}: ${err instanceof Error ? err.message : err}`);
    }
    return;
  }

  // ── Regular proxy request (cookie must be present) ──
  const target = getTarget(req);
  if (!target) {
    res.writeHead(200);
    res.end("proq live proxy");
    return;
  }

  const targetUrl = target.replace(/\/$/, "") + (req.url || "/");

  try {
    const bodyBuf =
      req.method !== "GET" && req.method !== "HEAD" ? await readBody(req) : undefined;

    const resp = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders(req),
      body: bodyBuf ? new Uint8Array(bodyBuf) : undefined,
    });

    const ct = resp.headers.get("content-type") || "";

    if (ct.includes("text/html")) {
      let html = await resp.text();
      html = injectTracker(html);
      res.writeHead(resp.status, {
        "Content-Type": ct,
        "Cache-Control": "no-cache",
      });
      res.end(html);
      return;
    }

    // Non-HTML: stream through
    const resHeaders: Record<string, string> = {};
    const skipH = new Set(["transfer-encoding", "connection", "keep-alive"]);
    resp.headers.forEach((v, k) => {
      if (!skipH.has(k)) resHeaders[k] = v;
    });
    res.writeHead(resp.status, resHeaders);

    if (resp.body) {
      const reader = resp.body.getReader();
      const pump = async (): Promise<void> => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.destroyed) res.write(Buffer.from(value));
        }
        if (!res.destroyed) res.end();
      };
      pump().catch(() => {
        if (!res.destroyed) res.end();
      });
      res.on("close", () => reader.cancel());
    } else {
      res.end();
    }
  } catch (err) {
    if (!res.destroyed) {
      res.writeHead(502);
      res.end(`Proxy error: ${err instanceof Error ? err.message : err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

const WS_PORT = parseInt(process.env.PROQ_WS_PORT || process.env.NEXT_PUBLIC_WS_PORT || "42069", 10);
const PROXY_PORT = WS_PORT + 1;

let proxyStarted = false;

export function startProxyServer(): void {
  if (proxyStarted) return;
  proxyStarted = true;

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      if (!res.destroyed) {
        res.writeHead(500);
        res.end(`Internal proxy error: ${err instanceof Error ? err.message : err}`);
      }
    });
  });

  server.listen(PROXY_PORT, () => {
    console.log(`> Live proxy on http://localhost:${PROXY_PORT}`);
  });
}
