/**
 * Per-code monthly usage cap, backed by Cloudflare KV.
 *
 * Every call to the generate endpoint costs a real Anthropic API call, unlike
 * the rest of a typical static site. Without a cap, one leaked or shared code
 * could run unlimited generations at the owner's expense. This keys usage by
 * the SAME access code the gate already validates (functions/_middleware.js),
 * so there is no separate account system to build.
 *
 * Requires a KV namespace bound as `USAGE` in the Cloudflare Pages project
 * settings (Settings -> Functions -> KV namespace bindings). See docs/SETUP.md.
 */

const DEFAULT_MONTHLY_LIMIT = 5;

function monthKey(code) {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `usage:${code}:${ym}`;
}

/** Read current usage without incrementing. */
export async function getUsage(env, code) {
  const limit = Number(env.MONTHLY_LIMIT) || DEFAULT_MONTHLY_LIMIT;
  const key = monthKey(code);
  const used = Number((await env.USAGE.get(key)) || "0");
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Atomically-enough increment for this traffic scale: read, check, write.
 * A true race (two simultaneous requests from the same code at the exact same
 * instant) could both pass the check before either write lands, letting one
 * request through over the cap in the rare worst case. Given this product's
 * per-customer volume, that is an acceptable tradeoff against needing a
 * Durable Object just to serialize a counter that increments a few times a day.
 */
export async function checkAndIncrement(env, code) {
  const limit = Number(env.MONTHLY_LIMIT) || DEFAULT_MONTHLY_LIMIT;
  const key = monthKey(code);
  const used = Number((await env.USAGE.get(key)) || "0");

  if (used >= limit) {
    return { allowed: false, used, limit, remaining: 0 };
  }

  const next = used + 1;
  // Expire well past month-end so a slow clock skew never drops a live counter early.
  await env.USAGE.put(key, String(next), { expirationTtl: 60 * 60 * 24 * 40 });
  return { allowed: true, used: next, limit, remaining: Math.max(0, limit - next) };
}
