# Deploying this site

This deploys as a plain **Cloudflare Worker with static assets** (`wrangler.toml`
+ `src/worker.js`), not Cloudflare Pages — no separate server to run yourself,
but note this is a different Cloudflare product than the sister job-database
project (gcc-cis), which uses classic Pages with its automatic `functions/`
directory routing. That convention doesn't apply here; `src/worker.js` does
the routing itself. See "Why this isn't Pages" below if you're wondering why.

## What's different from a plain static site

Every use of the resume/cover-letter generator calls the OpenAI API (Responses
API, model `gpt-4.1`), which costs real money per call — unlike the rest of the
page, which is free to serve once deployed. Two things exist specifically to
control that:

- **`ACCESS_CODES`** — same one-code-per-customer gate as the sister site, so
  only paying customers can reach the feature at all.
- **A monthly usage cap per code**, enforced in `src/api/generate.js` via
  Cloudflare KV (`src/lib/usage.js`). The analysis/preview step
  (`src/api/analyze.js`) is deliberately NOT capped — it's meant to feel free
  to explore before committing to a generation. If preview abuse becomes a
  real problem in practice, add the same `checkAndIncrement` call there too.

## First deploy

1. **dash.cloudflare.com** → **Workers & Pages** → **Create** → look for
   **"Import a repository"** (or similar — connects a Git repo to a Worker,
   as distinct from the "Pages" tab). Pick this repository.
2. Cloudflare detects `wrangler.toml` and `src/worker.js` automatically — no
   build command needed, nothing to configure there.
3. Save and deploy. You'll get a `<something>.workers.dev` URL (or, if you
   picked a Pages-based flow instead, `.pages.dev` — either works, the code
   doesn't care which).

## Required configuration (won't work without these)

A Worker that deploys as "static assets only" (no bindings/variables
available in its Settings) means Cloudflare didn't detect `wrangler.toml` —
double check it's committed at the repo root and redeploy.

### 1. OpenAI API key

This project's Settings → **Variables and Secrets** → Add → name exactly
**`OPENAI_API_KEY`** (Production), your own key from platform.openai.com (now
developers.openai.com — OpenAI moved its docs/dashboard domain). Mark it as a
**secret**, not a plain variable — it must never be readable from the
dashboard UI after saving.

### 2. Access codes

Same as the job-database site:
```bash
python3 scripts/make_codes.py --count 25 --site https://your-site.workers.dev
```
Paste the comma-separated list into Settings → **Variables and Secrets** →
**`ACCESS_CODES`** (Production). Until this is set, the site stays open to
anyone — deploy, confirm it loads, set this, then redeploy.

### 3. Usage-cap KV namespace

**Workers & Pages → KV → Create namespace**, name it anything (e.g.
`cvt-usage`). Then on this Worker: Settings → **Bindings** → **Add** → **KV
namespace**, variable name exactly **`USAGE`**, pointing at that namespace.
(Alternative: uncomment and fill in the `[[kv_namespaces]]` block already
present in `wrangler.toml`, then redeploy — either path binds the same thing.)

Optionally set **`MONTHLY_LIMIT`** (a plain environment variable, e.g. `5`) to
change the per-code monthly cap from the default of 5. This applies to
`/api/generate` only, per the note above.

## Revoking a code

Identical to the job-database site: remove it from `ACCESS_CODES`, save. Takes
effect within seconds, on every device that had activated with it, and does
not affect any other customer.

## Why this isn't Pages (if you're wondering)

The first deploy of this project landed as a plain Worker (Cloudflare's newer
Git-connected "Workers Builds" flow) rather than classic Pages, and without a
`wrangler.toml` telling it there was a Worker script to run, Cloudflare served
it as static-files-only — every `/api/*` request 404'd, and Settings couldn't
even offer environment variables or bindings ("Variables/Bindings cannot be
added to a Worker that only has static assets"). Adding `wrangler.toml` +
`src/worker.js` (which does its own routing: gate check, then `/api/analyze`
and `/api/generate`, then falls through to serving `public/` as static assets
via the `ASSETS` binding) is what fixes that — this is the standard shape for
a Worker that's part API, part static site, and it's the direction Cloudflare
itself is unifying Pages and Workers toward.

## What this product borrows from career-ops, and why

The resume/cover-letter writing rules baked into `src/api/generate.js`
(no-fabrication rule, keyword-reformulation-not-invention, the cover-letter
banned-word list and 350-420 word target) and `public/templates/cover-letter-template.html`
are adapted from **career-ops** (career-ops-hq/career-ops), MIT-licensed. See
`NOTICE.md` for the full attribution. They were carried over deliberately —
they are the tested difference between generic AI output and something worth a
candidate paying for, not something to reinvent from scratch.

This product does not run career-ops itself (it's a local CLI, not embeddable
in a web backend) — it reuses its written rules and one template, re-implemented
here as a stateless web API.
