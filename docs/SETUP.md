# Deploying this site

Same hosting model as its sister project (the gcc-cis job database): a static
site plus Cloudflare Pages Functions, no separate server, no build step.

## What's different from a plain static site

Every use of the resume/cover-letter generator calls the Anthropic API, which
costs real money per call — unlike the rest of the page, which is free to serve
once deployed. Two things exist specifically to control that:

- **`ACCESS_CODES`** — same one-code-per-customer gate as before, so only
  paying customers can reach the feature at all.
- **A monthly usage cap per code**, enforced in `functions/api/generate.js` via
  Cloudflare KV (`functions/lib/usage.js`). The analysis/preview step
  (`functions/api/analyze.js`) is deliberately NOT capped — it's meant to feel
  free to explore before committing to a generation. If preview abuse becomes a
  real problem in practice, add the same `checkAndIncrement` call there too.

## First deploy

1. **dash.cloudflare.com** → Workers & Pages → Create → Pages → Connect to Git
2. Pick this repository
3. Settings:
   - Framework preset: **None**
   - Build command: **(leave empty)**
   - Build output directory: **`/`** (the repo root — `index.html` lives there)
4. Save and deploy.

## Required configuration (won't work without these)

### 1. Anthropic API key

Settings → Environment variables → add **`ANTHROPIC_API_KEY`** (Production),
your own key from console.anthropic.com. Mark it as a **secret**, not a plain
variable — it must never be readable from the dashboard UI after saving.

### 2. Access codes

Same as the job-database site:
```bash
python3 scripts/make_codes.py --count 25 --site https://your-site.pages.dev
```
Paste the comma-separated list into Settings → Environment variables →
**`ACCESS_CODES`** (Production). Until this is set, the site stays open to
anyone — deploy, confirm it loads, set this, then redeploy.

### 3. Usage-cap KV namespace

Workers & Pages → KV → Create namespace, name it anything (e.g. `cvt-usage`).
Then on this Pages project: Settings → Functions → KV namespace bindings →
add a binding named exactly **`USAGE`** pointing at that namespace.

Optionally set **`MONTHLY_LIMIT`** (a plain environment variable, e.g. `5`) to
change the per-code monthly cap from the default of 5. This applies to
`/api/generate` only, per the note above.

## Revoking a code

Identical to the job-database site: remove it from `ACCESS_CODES`, save. Takes
effect within seconds, on every device that had activated with it, and does
not affect any other customer.

## What this product borrows from career-ops, and why

The resume/cover-letter writing rules baked into `functions/api/generate.js`
(no-fabrication rule, keyword-reformulation-not-invention, the cover-letter
banned-word list and 350-420 word target) and `templates/cover-letter-template.html`
are adapted from **career-ops** (career-ops-hq/career-ops), MIT-licensed. See
`NOTICE.md` for the full attribution. They were carried over deliberately —
they are the tested difference between generic AI output and something worth a
candidate paying for, not something to reinvent from scratch.

This product does not run career-ops itself (it's a local CLI, not embeddable
in a web backend) — it reuses its written rules and one template, re-implemented
here as a stateless web API.
