import { fetchJobPage } from "../lib/fetchJob.js";
import { extractDocxText } from "../lib/docx.js";
import { buildJobAndCvContent, callOpenAI } from "../lib/openai.js";
import { renderResume, renderCoverLetter } from "../lib/render.js";
import { checkAndIncrement } from "../lib/usage.js";

/**
 * Step 2 (final) of the flow: given the same job + CV as /api/analyze, plus the
 * candidate's short answers (why this role, what to emphasize, how to handle
 * each detected gap), generate a tailored resume and cover letter.
 *
 * Writing rules below are adapted from career-ops (career-ops-hq/career-ops,
 * MIT License) — modes/_shared.md's keyword-injection rule and modes/cover.md's
 * language rules, which this project's owner specifically wanted preserved
 * rather than reinvented, because they're the actual difference between a
 * generic AI-sounding letter and one worth a candidate paying for.
 */

const GENERATE_SYSTEM = `You write a tailored, ATS-optimized resume and cover letter for ONE specific
job application. You are given: the job posting (HTML or screenshots), the candidate's real CV
(PDF or text), and the candidate's own short answers about why they want this role, what to
emphasize, and how they want to handle any gaps between their CV and the posting.

ABSOLUTE RULES — breaking any of these makes the output actively harmful to the candidate, who is
trusting this to represent them truthfully to an employer:
1. NEVER invent experience, employers, titles, dates, metrics, skills, or credentials that are not
   in the candidate's actual CV. Every fact in the resume and cover letter must trace back to the
   CV you were given.
2. Keyword injection is REFORMULATION, never fabrication. Example: the job says "REST
   microservices" and the CV says "Express.js APIs" -> write "REST microservices using
   Express.js". Example: the job says "PostgreSQL on AWS RDS" and the CV only says "PostgreSQL
   with Supabase" -> keep it as Supabase; do NOT claim AWS RDS experience the candidate doesn't
   have, even though it would score better against the posting's keywords.
3. Honor the candidate's own gap answers exactly. If they said "don't mention it", do not mention
   it. If they gave you their own angle on a gap, use their words and framing, not your own
   invented justification.
4. The resume mirrors the candidate's real CV content — same jobs, same real bullets — reordered
   by relevance to this posting and reworded only per rule 2. Do not add sections, employers, or
   line items that are not in the source CV. If a field genuinely has no value for a given entry
   (e.g. a remote role with no city), use an empty string rather than inventing one.

COVER LETTER STYLE (these make it read like a person, not an AI):
- Active voice only. Never "was delivered", "has been built", "were led".
- No em dashes anywhere in the letter.
- Banned words/phrases: holistic, championed, orchestrated, excited, stakeholder alignment,
  data-driven, actionable insights, move the needle, north star, unique opportunity, perfect fit,
  strong track record, "I am pleased to", "I am writing to express", "I am excited to".
- Concrete over abstract: every claim needs a number, a system name, or a specific outcome.
  "Improved performance" is banned; "cut latency from 2s to 380ms" is fine — but only if that
  number is actually in the candidate's CV.
- 350-420 words in the letter body.
- Achievement bullets: pick 4-5 from the CV that best match this posting's top requirements, each
  with at least one real metric from the CV.
- Self-check before finalizing: could this sentence appear in a cover letter for literally any
  company? If yes, make it specific to this one.
- Use the candidate's "why this role" and "what to emphasize" answers directly to shape the
  opening and the problems-I-will-solve section — this is the candidate's own voice and reasoning,
  not something to override with generic language.
- If there is no named hiring manager, leave greeting as an empty string (the letter renders
  without a salutation line rather than a fake "Dear Hiring Manager,").

LANGUAGE: write both documents in the same language as the job posting. If the posting is in
English, write in English, regardless of what language these instructions are in.

If a JD keyword genuinely cannot be worked in honestly (the candidate has no related experience
at all), list it in unmatchedKeywords instead of forcing it in.`;

// Strict Structured Outputs schema: every object needs additionalProperties:false, and every
// property must be listed as required (OpenAI's strict mode has no concept of optional keys).
// Fields that are legitimately sometimes empty (location, dates, greeting, projects) are plain
// strings/arrays the model is instructed above to leave empty rather than typed as nullable —
// simpler for the renderer than threading null-checks through render.js.
const GENERATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    resume: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        contactLine: { type: "string" },
        summary: { type: "string" },
        skills: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { category: { type: "string" }, items: { type: "array", items: { type: "string" } } },
            required: ["category", "items"],
          },
        },
        experience: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" }, company: { type: "string" }, location: { type: "string" },
              dates: { type: "string" }, bullets: { type: "array", items: { type: "string" } },
            },
            required: ["title", "company", "location", "dates", "bullets"],
          },
        },
        education: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { degree: { type: "string" }, institution: { type: "string" }, dates: { type: "string" } },
            required: ["degree", "institution", "dates"],
          },
        },
        projects: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { name: { type: "string" }, description: { type: "string" } },
            required: ["name", "description"],
          },
        },
      },
      required: ["name", "contactLine", "summary", "skills", "experience", "education", "projects"],
    },
    coverLetter: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" }, contactLine: { type: "string" }, roleTitle: { type: "string" },
        company: { type: "string" }, greeting: { type: "string" }, opening: { type: "string" },
        profileIntro: { type: "string" },
        achievements: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { lead: { type: "string" }, impact: { type: "string" } },
            required: ["lead", "impact"],
          },
        },
        problemsSection: { type: "string" }, closing: { type: "string" },
      },
      required: ["name", "contactLine", "roleTitle", "company", "greeting", "opening", "profileIntro", "achievements", "problemsSection", "closing"],
    },
    unmatchedKeywords: { type: "array", items: { type: "string" } },
  },
  required: ["resume", "coverLetter", "unmatchedKeywords"],
};

/**
 * Called directly by src/worker.js's router (this project is a plain Worker
 * with static assets, not Cloudflare Pages — see wrangler.toml — so there's
 * no automatic functions/ directory convention; the Worker dispatches to this
 * function itself for POST /api/generate, passing the accessCode the gate
 * already resolved for this request).
 */
export async function handleGenerate(request, env, accessCode) {
  // No ACCESS_CODES configured means the gate stays fully open (see
  // src/lib/gate.js) -- anyone with the URL can reach this endpoint, and every
  // call still costs a real OpenAI API call. Key the usage cap by access code
  // when one exists; otherwise fall back to the caller's IP so an open site
  // still has SOME per-visitor limit rather than none at all. This is not
  // real protection -- a VPN or shared IP can dodge it -- so turn access codes
  // on (see docs/SETUP.md) before sharing this link outside a small test.
  const usageKey = accessCode || request.headers.get("CF-Connecting-IP") || "unknown";

  if (env.USAGE) {
    const usage = await checkAndIncrement(env, usageKey);
    if (!usage.allowed) {
      return json(
        { ok: false, error: "monthly_limit_reached", limit: usage.limit, used: usage.used },
        429
      );
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request body." }, 400);
  }

  const { jobUrl, jobImages, cv, answers } = body;

  if (!cv || (cv.kind !== "pdf" && cv.kind !== "docx") || !cv.base64) {
    return json({ ok: false, error: "A CV file (PDF or Word) is required." }, 400);
  }
  if (!answers || !answers.whyThisRole) {
    return json({ ok: false, error: "Missing the candidate's answers from the analysis step." }, 400);
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
      return json({ ok: false, error: "fetch_failed", reason: fetched.reason }, 422);
    }
    jobBlock = { kind: "html", html: fetched.html };
  } else {
    return json({ ok: false, error: "Provide either a job URL or job screenshots." }, 400);
  }

  const content = buildJobAndCvContent(cvBlock, jobBlock);
  content.push({
    type: "input_text",
    text: `CANDIDATE'S OWN ANSWERS (use these to personalize — do not override with generic language):
Why this role: ${answers.whyThisRole}
What to emphasize: ${answers.emphasize || "(not specified)"}
Gap answers: ${(answers.gapAnswers || []).map((g) => `\n  - ${g.issue}: ${g.answer}`).join("") || "(no gaps flagged)"}
Today's date: ${new Date().toISOString().slice(0, 10)}`,
  });

  let result;
  try {
    result = await callOpenAI(env, { system: GENERATE_SYSTEM, content, schema: GENERATE_SCHEMA, maxOutputTokens: 6000 });
  } catch (err) {
    return json({ ok: false, error: err.message }, 502);
  }

  const coverLetterDate = new Date().toISOString().slice(0, 10);

  try {
    const [resumeHtml, coverLetterHtml] = await Promise.all([
      renderResume(env, request, result.resume),
      renderCoverLetter(env, request, { ...result.coverLetter, date: coverLetterDate }),
    ]);
    return json({ ok: true, resumeHtml, coverLetterHtml, unmatchedKeywords: result.unmatchedKeywords });
  } catch (err) {
    return json({ ok: false, error: `Rendering failed: ${err.message}` }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
