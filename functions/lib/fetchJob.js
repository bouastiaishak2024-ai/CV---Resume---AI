/**
 * Best-effort fetch of a pasted job-posting URL, with honest failure detection.
 *
 * Many boards (LinkedIn, Indeed, and others) actively block automated fetching
 * with a Cloudflare or Akamai wall — this was learned the hard way building this
 * product family's job harvester, not assumed. Rather than silently returning a
 * useless block page as if it were the job description, this detects the known
 * signatures and reports failure so the UI can fall back to asking the customer
 * for screenshots instead.
 */

const BLOCK_SIGNATURES = [
  /just a moment/i, // Cloudflare interactive challenge
  /checking your browser/i,
  /access denied/i, // Akamai and generic WAF block pages
  /request unsuccessful/i,
  /captcha/i,
  /verify you are human/i,
  /security check/i,
];

export async function fetchJobPage(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "invalid_url" };
  }

  let res;
  try {
    res = await fetch(parsed.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      cf: { cacheTtl: 0 },
    });
  } catch (err) {
    return { ok: false, reason: "network_error", detail: String(err) };
  }

  if (res.status === 403 || res.status === 429 || res.status >= 500) {
    return { ok: false, reason: "blocked", status: res.status };
  }
  if (!res.ok) {
    return { ok: false, reason: "not_found", status: res.status };
  }

  const html = await res.text();
  if (BLOCK_SIGNATURES.some((rx) => rx.test(html.slice(0, 4000)))) {
    return { ok: false, reason: "blocked" };
  }
  if (html.length < 500) {
    // Real job pages are not this short; a near-empty body usually means a
    // JS-only shell that never rendered anything server-side for us to read.
    return { ok: false, reason: "empty_shell" };
  }

  return { ok: true, html };
}
