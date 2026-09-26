/**
 * Entry point for this Worker (see wrangler.toml — deployed as a plain Worker
 * with a static-assets binding, not Cloudflare Pages, so there's no automatic
 * functions/ directory routing; every request comes through here first).
 *
 * Order: access gate -> API routes -> static assets fallback.
 */
import { checkGate } from "./lib/gate.js";
import { handleAnalyze } from "./api/analyze.js";
import { handleGenerate } from "./api/generate.js";

export default {
  async fetch(request, env) {
    const gate = await checkGate(request, env);
    if (!gate.proceed) return gate.response;

    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/analyze") {
      return handleAnalyze(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/generate") {
      return handleGenerate(request, env, gate.accessCode);
    }

    // Everything else (index.html, /templates/*) is a static file served by
    // the [assets] binding configured in wrangler.toml.
    return env.ASSETS.fetch(request);
  },
};
