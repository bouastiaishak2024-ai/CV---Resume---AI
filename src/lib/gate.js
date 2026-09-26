/**
 * Access gate — same model as the بوصلة الخليج site's gate (gcc-cis repo):
 * ONE permanent URL per customer relationship, ONE activation code, checked
 * before any page or API route runs.
 *
 * Originally written as a Cloudflare Pages "_middleware.js" (which runs
 * automatically for every request under that product). This project deploys
 * as a plain Worker with static assets instead (see wrangler.toml and
 * src/worker.js — Pages' automatic functions/ routing doesn't apply here), so
 * this is now a plain function the Worker's router calls itself, once, at the
 * top of every request. The activation logic and cookie handling are
 * otherwise unchanged.
 *
 * Codes live in the ACCESS_CODES environment variable (Cloudflare dashboard),
 * comma-separated, never in git. Editing takes effect within seconds.
 */

const COOKIE = "cvt_access";
const MAX_AGE = 60 * 60 * 24 * 730; // two years

/**
 * Returns { proceed: true, accessCode: string|null } when the request should
 * continue to routing, or { proceed: false, response: Response } when the
 * gate itself must answer the request (activation page or activation redirect).
 */
export async function checkGate(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/robots.txt") return { proceed: true, accessCode: null };

  const valid = (env.ACCESS_CODES || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  // No codes configured yet: stay open, so setup never locks you out of your own site.
  if (valid.length === 0) return { proceed: true, accessCode: null };

  const fromQuery = (url.searchParams.get("k") || "").trim().toUpperCase();
  const fromCookie = (request.headers.get("Cookie") || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);

  if (fromCookie && valid.includes(fromCookie)) {
    return { proceed: true, accessCode: fromCookie };
  }

  if (fromQuery) {
    if (valid.includes(fromQuery)) {
      url.searchParams.delete("k");
      return {
        proceed: false,
        response: new Response(null, {
          status: 302,
          headers: {
            Location: url.pathname + url.search + url.hash,
            "Set-Cookie": `${COOKIE}=${fromQuery}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`,
            "Cache-Control": "no-store",
          },
        }),
      };
    }
    return { proceed: false, response: activationPage(true) };
  }

  return { proceed: false, response: activationPage(false) };
}

function activationPage(wrongCode) {
  const err = wrongCode
    ? `<p class="err">الرمز غير صحيح. تحقّق من الحروف وأعد المحاولة.</p>`
    : "";
  return new Response(
    `<!doctype html><html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>تفعيل الوصول</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=Reem+Kufi:wght@600&family=IBM+Plex+Mono:wght@500&display=swap">
<style>
:root{--navy:#1B2A4A;--ink:#0E1729;--gold:#C9A227;--paper:#F2F5FA;--surface:#fff;
 --slate:#5A6780;--rule:#C9D3E2;--stop:#93332C;--stop-bg:#F8E4E1}
@media(prefers-color-scheme:dark){:root{--navy:#8FA6CE;--ink:#E8EDF6;--gold:#D8B64A;
 --paper:#0C1220;--surface:#141C2E;--slate:#98A5BD;--rule:#2C3950;--stop:#E8968C;--stop-bg:#3A1A18}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
 background:var(--paper);color:var(--ink);font-family:"IBM Plex Sans Arabic",system-ui,sans-serif;
 font-size:15px;line-height:1.7}
.card{background:var(--surface);border:1px solid var(--rule);max-width:31rem;width:100%;padding:34px 30px}
h1{margin:0 0 6px;font-family:"Reem Kufi",sans-serif;font-size:21px;color:var(--navy);text-align:center}
.sub{margin:0 0 22px;text-align:center;font-size:13.5px;color:var(--slate)}
label{display:block;font-size:13px;color:var(--slate);margin-bottom:7px;font-weight:500}
input{width:100%;font:inherit;font-family:"IBM Plex Mono",monospace;font-size:16px;letter-spacing:.06em;
 padding:12px 13px;border:1px solid var(--rule);border-radius:2px;background:var(--paper);
 color:var(--ink);direction:ltr;text-align:center;text-transform:uppercase}
input:focus{outline:2px solid var(--gold);outline-offset:1px}
button{width:100%;margin-top:14px;background:var(--navy);color:var(--paper);border:0;border-radius:2px;
 padding:12px;font:inherit;font-weight:600;font-size:15px;cursor:pointer}
button:hover{opacity:.92}
.err{margin:0 0 14px;background:var(--stop-bg);color:var(--stop);border:1px solid var(--stop);
 padding:9px 12px;font-size:13.5px;font-weight:500}
</style></head><body>
<div class="card">
 <h1>تفعيل الوصول</h1>
 <p class="sub">أدخل رمز التفعيل الذي استلمته عند الشراء. تحتاج إلى إدخاله مرة واحدة فقط على هذا الجهاز.</p>
 ${err}
 <form method="GET" action="/">
  <label for="k">رمز التفعيل</label>
  <input id="k" name="k" autocomplete="off" autocapitalize="characters" spellcheck="false"
         placeholder="XXXX-XXXX-XXXX-XXXX" required autofocus>
  <button type="submit">تفعيل</button>
 </form>
</div></body></html>`,
    {
      status: 401,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    }
  );
}
