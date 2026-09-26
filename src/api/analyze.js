import { fetchJobPage } from "../lib/fetchJob.js";
import { extractDocxText } from "../lib/docx.js";
import { buildJobAndCvContent, callOpenAI } from "../lib/openai.js";

/**
 * Step 1 of the flow: given a job (URL or screenshots) and a CV, return a quick
 * analysis — role, company, the ATS keywords this posting actually uses, and
 * any real gaps between the CV and the posting. The UI shows this to the
 * candidate and asks them how to handle each gap before final generation, the
 * same principle career-ops's cover-letter mode uses (surface gaps, let the
 * human decide) rather than silently papering over them or silently inventing
 * an answer.
 *
 * This step is intentionally NOT counted against the monthly generation cap —
 * see docs/SETUP.md "Usage cap" for why, and adjust MONTHLY_LIMIT accordingly
 * if preview abuse becomes an issue in practice.
 */

const ANALYZE_SYSTEM = `You are the analysis step of a job-application assistant. You are given a
job posting (as raw fetched HTML, which may contain navigation/footer noise, OR as screenshot
images) and a candidate's CV (as a PDF document or plain text).

Your job: find the actual job posting inside the input, and report back facts a human would need
before drafting a tailored resume and cover letter for it.

RULES (violating any of these makes your output unusable — follow them exactly):
- Never invent a company name, role title, or requirement that is not actually present in the
  job input. If the input does not contain a real, identifiable job posting, set jobFound to
  false and leave the other fields as empty strings/arrays rather than guessing.
- Keywords must be exact phrases lifted from the posting, not your own paraphrase of it.
- A "gap" is something the posting asks for that the CV does not clearly show — never invent a
  gap that does not exist, and never assume the candidate lacks something the CV is simply silent
  about versus something the CV actively contradicts. If you are unsure whether something is a
  real gap, do not list it.
- Each gap's "question" must be a short, direct question FOR THE CANDIDATE about how they want to
  handle that specific gap (e.g. address it directly, don't mention it, or explain their own
  angle) — not a statement, not advice, not something you answer yourself.
- List at most 3 gaps. Most CVs against most postings have 0-2 real gaps; do not manufacture a
  third to fill a quota. Return fewer items in the gaps array rather than padding it.`;

// Strict Structured Outputs schema: every object needs additionalProperties:false,
// and every property must be listed as required (no true optionals) — see openai.js.
const ANALYZE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    jobFound: { type: "boolean" },
    roleTitle: { type: "string" },
    company: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
    gaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { issue: { type: "string" }, question: { type: "string" } },
        required: ["issue", "question"],
      },
    },
  },
  required: ["jobFound", "roleTitle", "company", "keywords", "gaps"],
};

/**
 * Called directly by src/worker.js's router (this project is a plain Worker
 * with static assets, not Cloudflare Pages — see wrangler.toml — so there's
 * no automatic functions/ directory convention; the Worker dispatches to this
 * function itself for POST /api/analyze).
 */
export async function handleAnalyze(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request body." }, 400);
  }

  const { jobUrl, jobImages, cv } = body;

  if (!cv || (cv.kind !== "pdf" && cv.kind !== "docx") || !cv.base64) {
    return json({ ok: false, error: "A CV file (PDF or Word) is required." }, 400);
  }

  let cvBlock;
  try {
    cvBlock =
      cv.kind === "docx"
        ? { kind: "text", text: await extractDocxText(cv.base64) }
        : { kind: "pdf", base64: cv.base64 };
  } catch (err) {
    return json({ ok: false, error: `Could not read the uploaded CV: ${err.message}` }, 422);
  }

  let jobBlock;
  if (Array.isArray(jobImages) && jobImages.length > 0) {
    jobBlock = { kind: "images", base64: jobImages };
  } else if (jobUrl) {
    const fetched = await fetchJobPage(jobUrl);
    if (!fetched.ok) {
      return json({ ok: false, error: "fetch_failed", reason: fetched.reason, needsScreenshots: true }, 200);
    }
    jobBlock = { kind: "html", html: fetched.html };
  } else {
    return json({ ok: false, error: "Provide either a job URL or job screenshots." }, 400);
  }

  try {
    const result = await callOpenAI(env, {
      system: ANALYZE_SYSTEM,
      content: buildJobAndCvContent(cvBlock, jobBlock),
      schema: ANALYZE_SCHEMA,
      maxOutputTokens: 1500,
    });
    return json({ ok: true, ...result });
  } catch (err) {
    return json({ ok: false, error: err.message }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
