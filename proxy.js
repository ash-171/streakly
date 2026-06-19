/**
 * Streakly CORS proxy — no npm needed, built-in Node modules only.
 * Run: node proxy.js
 *
 * In the app Settings → "API Base URL", set:  http://localhost:11435
 * Keep your Ollama API key in Settings as usual — the browser sends it
 * through the proxy to ollama.com unchanged.
 */

const http  = require("http");
const https = require("https");

const PORT   = 11435;
const TARGET = "ollama.com";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const server = http.createServer((req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  // Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const opts = {
    hostname: TARGET,
    port:     443,
    path:     req.url,
    method:   req.method,
    headers:  { ...req.headers, host: TARGET }
  };

  const proxy = https.request(opts, (upstream) => {
    // Forward upstream CORS-safe headers; our own CORS headers already set
    const forward = {};
    ["content-type", "content-length"].forEach(h => {
      if (upstream.headers[h]) forward[h] = upstream.headers[h];
    });
    res.writeHead(upstream.statusCode, { ...forward, ...CORS });
    upstream.pipe(res, { end: true });
  });

  proxy.on("error", (err) => {
    console.error("Proxy error:", err.message);
    res.writeHead(502, CORS);
    res.end(JSON.stringify({ error: "Proxy could not reach ollama.com: " + err.message }));
  });

  req.pipe(proxy, { end: true });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`✓ Streakly proxy listening on http://localhost:${PORT}`);
  console.log(`  In the app: Settings → API Base URL → http://localhost:${PORT}`);
  console.log(`  Press Ctrl+C to stop.\n`);
});