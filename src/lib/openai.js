/**
 * Thin wrapper around OpenAI's Responses API (POST /v1/responses) for the two
 * endpoints that need it (analyze, generate). No SDK dependency — Cloudflare
 * Pages Functions ship with zero npm install step (see docs/SETUP.md), so this
 * is a plain fetch call, matching the rest of this project's zero-dependency
 * style.
 *
 * Responses API chosen over the older Chat Completions API because it has the
 * richest, most explicitly documented support for all three things this
 * product needs together: vision input (screenshots), direct PDF input (the
 * CV, no separate text-extraction step needed), and Structured Outputs. Model
 * is gpt-4.1 specifically because OpenAI's own docs use it as the worked
 * example for combining vision + structured outputs + PDF file input
 * simultaneously — the newer GPT-6 family's docs list vision and structured
 * outputs but do not explicitly confirm PDF file input, so this deliberately
 * does not use it yet (verify before switching).
 */

const API_URL = "https://api.openai.com/v1/responses";
const MODEL = "gpt-4.1";

/**
 * Build the Responses-API "input content" array for one "here is the job and
 * the CV" turn.
 *
 * cv: { kind: "pdf", base64 } | { kind: "text", text }
 * job: { kind: "html", html } | { kind: "images", base64[] }
 *
 * The CV is sent as an actual PDF file (input_file, inline file_data — no
 * upload-then-reference step needed since we already have the bytes from the
 * browser upload) rather than extracted text, so the model reads layout and
 * formatting the way a human would. Word (.docx) uploads are converted to
 * plain text by extractDocxText() in docx.js before reaching this function,
 * since OpenAI's file input only reads PDF.
 */
export function buildJobAndCvContent(cv, job) {
  const content = [];

  if (job.kind === "html") {
    const html = job.html.length > 60000 ? job.html.slice(0, 60000) : job.html;
    content.push({
      type: "input_text",
      text: `RAW FETCHED JOB PAGE (HTML, may include nav/footer noise — find the actual job posting inside it):\n\n${html}`,
    });
  } else if (job.kind === "images") {
    for (const b64 of job.base64) {
      content.push({ type: "input_image", image_url: `data:image/png;base64,${b64}`, detail: "auto" });
    }
    content.push({ type: "input_text", text: "The images above are screenshots of the job posting the candidate wants to apply to." });
  }

  if (cv.kind === "pdf") {
    content.push({ type: "input_file", filename: "cv.pdf", file_data: `data:application/pdf;base64,${cv.base64}` });
  } else {
    content.push({ type: "input_text", text: `CANDIDATE'S CV (plain text, extracted from their uploaded document):\n\n${cv.text}` });
  }

  return content;
}

/**
 * Call the model with a system prompt ("instructions") + one user turn made of
 * content parts. When `schema` is given, uses Structured Outputs (strict JSON
 * Schema mode) and returns the parsed object.
 *
 * Structured Outputs strict mode has real restrictions versus plain JSON
 * Schema — every schema passed here must already have additionalProperties:
 * false on every object (root and nested) and list every property as
 * required (no optional keys; represent "may be absent" as a nullable type
 * instead, e.g. ["string","null"]). This is NOT the same as Anthropic's
 * tool-use schema this file used to build against — see analyze.js/generate.js
 * for schemas already written in this stricter shape.
 */
export async function callOpenAI(env, { system, content, schema, maxOutputTokens = 4096 }) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured for this environment.");
  }

  const body = {
    model: MODEL,
    instructions: system,
    input: [{ role: "user", content }],
    max_output_tokens: maxOutputTokens,
  };

  if (schema) {
    body.text = { format: { type: "json_schema", name: "respond", schema, strict: true } };
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI API error ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = await res.json();

  const message = data.output?.find((item) => item.type === "message");
  const textPart = message?.content?.find((c) => c.type === "output_text");
  const text = textPart?.text || "";

  if (schema) {
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`Model did not return valid JSON for the expected structured result: ${err.message}`);
    }
  }

  return text;
}
