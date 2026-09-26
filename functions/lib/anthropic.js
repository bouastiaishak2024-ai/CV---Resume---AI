/**
 * Thin wrapper around the Anthropic Messages API for the two endpoints that need
 * it (analyze, generate). No SDK dependency — Cloudflare Pages Functions ship
 * with zero npm install step (see docs/SETUP.md), so this is a plain fetch call,
 * matching the rest of this project's zero-dependency style.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";

/**
 * Build the content-block array for one "here is the job and the CV" turn.
 *
 * cv: { kind: "pdf", base64 } | { kind: "text", text }
 * job: { kind: "html", html } | { kind: "images", base64[] }
 *
 * Sending the CV as an actual PDF document (not extracted text) lets Claude read
 * layout, tables and formatting the way a human would — more reliable than a
 * separate text-extraction library, and there is no such library that runs
 * cleanly in the Workers runtime this project deploys to anyway. Word (.docx)
 * uploads are converted to plain text by extractDocxText() in docx.js before
 * they ever reach this function, since Claude's document input only accepts PDF.
 */
export function buildJobAndCvBlocks(cv, job) {
  const blocks = [];

  if (job.kind === "html") {
    // Truncate defensively — this is a fetched page, not something to trust or
    // spend unbounded tokens on. Claude is asked to find the JD inside the noise.
    const html = job.html.length > 60000 ? job.html.slice(0, 60000) : job.html;
    blocks.push({
      type: "text",
      text: `RAW FETCHED JOB PAGE (HTML, may include nav/footer noise — find the actual job posting inside it):\n\n${html}`,
    });
  } else if (job.kind === "images") {
    for (const b64 of job.base64) {
      blocks.push({ type: "image", source: { type: "base64", media_type: "image/png", data: b64 } });
    }
    blocks.push({ type: "text", text: "The images above are screenshots of the job posting the candidate wants to apply to." });
  }

  if (cv.kind === "pdf") {
    blocks.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: cv.base64 },
    });
  } else {
    blocks.push({ type: "text", text: `CANDIDATE'S CV (plain text, extracted from their uploaded document):\n\n${cv.text}` });
  }

  return blocks;
}

/**
 * Call Claude with a system prompt + one user turn made of content blocks.
 * When `schema` is given, forces a single tool call and returns its parsed
 * input — the same "structured output via forced tool use" pattern used
 * elsewhere in this project's tooling, so callers never hand-parse prose.
 */
export async function callClaude(env, { system, blocks, schema, maxTokens = 4096 }) {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured for this environment.");
  }

  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: blocks }],
  };

  if (schema) {
    body.tools = [{ name: "respond", description: "Return the result.", input_schema: schema }];
    body.tool_choice = { type: "tool", name: "respond" };
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = await res.json();

  if (schema) {
    const toolUse = data.content?.find((c) => c.type === "tool_use");
    if (!toolUse) throw new Error("Model did not return the expected structured result.");
    return toolUse.input;
  }

  const textBlock = data.content?.find((c) => c.type === "text");
  return textBlock?.text || "";
}
