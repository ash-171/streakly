/**
 * Streakly CORS proxy — no npm needed, built-in Node modules only.
 * Run: node proxy.js
 *
 * In the app Settings → "API Base URL", set:  http://localhost:11435
 * Keep your Ollama API key in Settings as usual — the browser sends it
 * through the proxy to ollama.com unchanged.
 */

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,Authorization"
        }
      });
    }
    const url = new URL(req.url);
    const target = "https://ollama.com" + url.pathname + url.search;
    const headers = new Headers();
    headers.set("Content-Type", req.headers.get("Content-Type") || "application/json");
    if (req.headers.get("Authorization")) headers.set("Authorization", req.headers.get("Authorization"));

    const resp = await fetch(target, {
      method: req.method,
      headers,
      body: req.method !== "GET" ? await req.text() : undefined
    });
    const newResp = new Response(resp.body, resp);
    newResp.headers.set("Access-Control-Allow-Origin", "*");
    return newResp;
  }
};
