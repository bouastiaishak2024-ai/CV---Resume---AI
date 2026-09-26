# مساعد التقديم للوظائف — CV Tailor

A separate, standalone product from the بوصلة الخليج job database — its own
customers, own pricing, own access codes. Where بوصلة الخليج sells access to a
job listing database, this sells a tailored resume + cover letter for one
specific job the candidate already found, anywhere (any URL, or screenshots
when a site blocks automated fetching).

## How it works

1. Customer uploads their CV (PDF or Word) and pastes a job link, or uploads
   screenshots of the posting if the link can't be fetched automatically.
2. `/api/analyze` reads the posting and the CV, and returns the role, the ATS
   keywords the posting actually uses, and any real gaps between the CV and the
   posting — each phrased as a short question for the candidate to answer
   (address it, don't mention it, or explain their own angle).
3. The candidate answers those, plus two short questions (why this role, what
   to emphasize).
4. `/api/generate` produces a tailored, ATS-optimized resume and a cover letter
   — same underlying writing rules as career-ops (see `NOTICE.md`), rendered
   into print-ready HTML the candidate can save as a PDF from their own browser.

No database server, no user accounts beyond the same access-code gate the
sister project uses — see `docs/SETUP.md` to deploy. Deploys as a Cloudflare
Worker with static assets (`wrangler.toml`), not classic Pages like the sister
project — see SETUP.md's "Why this isn't Pages" for why that distinction
matters here.

## Why this isn't "run career-ops on the website"

career-ops (career-ops-hq/career-ops) is a local CLI tool — it runs inside
Claude Code/OpenCode on someone's own machine via `npx`, with a terminal
dashboard. It isn't something a non-technical customer can use directly. This
project reuses its actual writing rules and one HTML template (MIT-licensed,
attributed in `NOTICE.md`), reimplemented as a stateless web API a browser can
call directly — not the CLI itself.

## Structure

```
wrangler.toml                  Worker config: entry point + static-assets binding
src/worker.js                  entry point: gate check -> API routes -> static assets
src/lib/gate.js                access-code gate (same model as the sister site)
src/api/analyze.js             step 1: read the job + CV, surface keywords/gaps
src/api/generate.js            step 2: produce the tailored resume + cover letter
src/lib/openai.js              OpenAI Responses API call helper, no SDK dependency
src/lib/docx.js                dependency-free .docx text extractor
src/lib/fetchJob.js            job-URL fetch with bot-block detection
src/lib/render.js              fills the two HTML templates from the model's output
src/lib/usage.js               per-code monthly cap (Cloudflare KV)
public/index.html              the whole customer-facing flow (vanilla JS)
public/templates/resume-template.html
public/templates/cover-letter-template.html   adapted from career-ops, see NOTICE.md
scripts/make_codes.py          mint activation codes (same script as the sister project)
```
