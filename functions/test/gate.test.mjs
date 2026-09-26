// Same test approach as the sister project's functions/test/gate.test.mjs,
// adapted for this product's own cookie name. Run with: node functions/test/gate.test.mjs
import { onRequest } from "../_middleware.js";
const CODE = "K7M2-PQXR-93TD-BHVW";
const NEXT = async () => new Response("GENERATOR", { status: 200 });
const req = (path = "/", cookie = null) =>
  new Request("https://s.pages.dev" + path, { headers: cookie ? { Cookie: cookie } : {} });

const run = (path, cookie, codes = CODE) =>
  onRequest({ request: req(path, cookie), env: { ACCESS_CODES: codes }, next: NEXT, data: {} });

let pass = 0, fail = 0;
const check = async (name, promise, want) => {
  const r = await promise;
  const body = r.status === 200 ? await r.text() : "";
  const got = {
    status: r.status,
    served: body.includes("GENERATOR"),
    cookie: (r.headers.get("Set-Cookie") || "").includes(CODE),
    location: r.headers.get("Location"),
    activation: r.status === 401,
    error: r.status === 401 ? (await r.clone().text()).includes("الرمز غير صحيح") : false,
  };
  const ok = Object.entries(want).every(([k, v]) => got[k] === v);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log("      want", want, "\n      got ", got);
  ok ? pass++ : fail++;
};

await check("gate open when no codes configured",
  run("/", null, ""), { status: 200, served: true });
await check("bare URL, not activated -> activation page, no error",
  run("/"), { activation: true, served: false, error: false });
await check("wrong code -> activation page WITH error",
  run("/?k=WRONG-CODE-HERE-XXXX"), { activation: true, served: false, error: true });
await check("valid code -> 302 to clean URL, cookie set",
  run("/?k=" + CODE), { status: 302, cookie: true, location: "/" });
await check("lowercase code still accepted",
  run("/?k=" + CODE.toLowerCase()), { status: 302, cookie: true });
await check("valid cookie -> generator served, no redirect",
  run("/", "cvt_access=" + CODE), { status: 200, served: true });
await check("forged cookie -> activation page",
  run("/", "cvt_access=NOT-A-REAL-CODE-ABCD"), { activation: true, served: false, error: false });
await check("robots.txt served unauthenticated",
  run("/robots.txt"), { status: 200, served: true });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
