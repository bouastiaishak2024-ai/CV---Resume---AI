// Adapted for src/lib/gate.js's checkGate(request, env) function shape (a plain
// function called from src/worker.js's router, not a Pages _middleware.js
// export — see src/worker.js for why). Run with: node test/gate.test.mjs
import { checkGate } from "../src/lib/gate.js";
const CODE = "K7M2-PQXR-93TD-BHVW";
const req = (path = "/", cookie = null) =>
  new Request("https://s.workers.dev" + path, { headers: cookie ? { Cookie: cookie } : {} });

const run = (path, cookie, codes = CODE) => checkGate(req(path, cookie), { ACCESS_CODES: codes });

let pass = 0, fail = 0;
const check = async (name, promise, want) => {
  const r = await promise;
  const body = !r.proceed ? await r.response.clone().text() : "";
  const got = {
    proceed: r.proceed,
    accessCode: r.proceed ? r.accessCode : undefined,
    status: !r.proceed ? r.response.status : undefined,
    location: !r.proceed ? r.response.headers.get("Location") : undefined,
    cookieSet: !r.proceed ? (r.response.headers.get("Set-Cookie") || "").includes(CODE) : false,
    activation: !r.proceed && r.response.status === 401,
    error: !r.proceed && r.response.status === 401 ? body.includes("الرمز غير صحيح") : false,
  };
  const ok = Object.entries(want).every(([k, v]) => got[k] === v);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log("      want", want, "\n      got ", got);
  ok ? pass++ : fail++;
};

await check("gate open when no codes configured",
  run("/", null, ""), { proceed: true, accessCode: null });
await check("bare URL, not activated -> activation page, no error",
  run("/"), { proceed: false, activation: true, error: false });
await check("wrong code -> activation page WITH error",
  run("/?k=WRONG-CODE-HERE-XXXX"), { proceed: false, activation: true, error: true });
await check("valid code -> 302 to clean URL, cookie set",
  run("/?k=" + CODE), { proceed: false, status: 302, cookieSet: true, location: "/" });
await check("lowercase code still accepted",
  run("/?k=" + CODE.toLowerCase()), { proceed: false, status: 302, cookieSet: true });
await check("valid cookie -> proceeds with resolved access code",
  run("/", "cvt_access=" + CODE), { proceed: true, accessCode: CODE });
await check("forged cookie -> activation page",
  run("/", "cvt_access=NOT-A-REAL-CODE-ABCD"), { proceed: false, activation: true, error: false });
await check("robots.txt served unauthenticated",
  run("/robots.txt"), { proceed: true, accessCode: null });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
