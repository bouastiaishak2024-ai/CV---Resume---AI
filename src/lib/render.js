/**
 * Fill templates/resume-template.html and templates/cover-letter-template.html
 * from Claude's structured output. Rendering server-side from a fixed template
 * (rather than asking the model for raw HTML) keeps formatting consistent and
 * keeps the model's output to content only, matching the JSON-payload-then-
 * render split career-ops itself uses (see cover.md Step 9 / generate-cover-letter.mjs).
 *
 * Templates ship as plain static files under public/templates/ (see
 * wrangler.toml's [assets] block) rather than being bundled into the Worker
 * script, so they're readable/editable on their own. loadTemplate() reads
 * them through the ASSETS binding — the Worker's own static-asset handler,
 * reachable in-process via env.ASSETS.fetch() — rather than an HTTP round
 * trip back to the site's own origin, which is both unnecessary here and not
 * guaranteed to be the fastest or most reliable path for a Worker to fetch
 * its own static output.
 */

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function loadTemplate(env, request, name) {
  const url = new URL(`/templates/${name}`, request.url);
  const res = await env.ASSETS.fetch(new Request(url));
  if (!res.ok) throw new Error(`Template ${name} is missing from the deployed site.`);
  return res.text();
}

function fill(template, values) {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

export async function renderResume(env, request, resume) {
  const template = await loadTemplate(env, request, "resume-template.html");

  const skillsBlock = resume.skills
    .map(
      (s) =>
        `<div class="skills-row"><span class="cat">${escapeHtml(s.category)}: </span>${escapeHtml(s.items.join(", "))}</div>`
    )
    .join("\n");

  const experienceBlock = resume.experience
    .map(
      (job) => `<div class="job">
  <div class="job-head"><span>${escapeHtml(job.title)}, ${escapeHtml(job.company)}</span><span>${escapeHtml(job.dates)}</span></div>
  <div class="job-sub">${escapeHtml(job.location || "")}</div>
  <ul class="bullets">${job.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>
</div>`
    )
    .join("\n");

  const educationBlock = resume.education
    .map(
      (e) =>
        `<div class="edu-row"><span>${escapeHtml(e.degree)}, ${escapeHtml(e.institution)}</span><span>${escapeHtml(e.dates || "")}</span></div>`
    )
    .join("\n");

  const projectsSection =
    resume.projects && resume.projects.length
      ? `<h2>Projects</h2>` +
        resume.projects
          .map((p) => `<div class="proj"><span class="proj-name">${escapeHtml(p.name)}: </span>${escapeHtml(p.description)}</div>`)
          .join("\n")
      : "";

  return fill(template, {
    NAME: escapeHtml(resume.name),
    CONTACT_LINE: escapeHtml(resume.contactLine),
    SUMMARY: escapeHtml(resume.summary),
    SKILLS_BLOCK: skillsBlock,
    EXPERIENCE_BLOCK: experienceBlock,
    EDUCATION_BLOCK: educationBlock,
    PROJECTS_SECTION: projectsSection,
  });
}

export async function renderCoverLetter(env, request, letter) {
  const template = await loadTemplate(env, request, "cover-letter-template.html");

  const greetingBlock = letter.greeting ? `<p class="greeting">${escapeHtml(letter.greeting)}</p>` : "";
  const achievementsBlock = letter.achievements
    .map((a) => `<li><strong>${escapeHtml(a.lead)},</strong> ${escapeHtml(a.impact)}</li>`)
    .join("");

  return fill(template, {
    NAME: escapeHtml(letter.name),
    CONTACT_LINE: escapeHtml(letter.contactLine),
    ROLE_TITLE: escapeHtml(letter.roleTitle),
    COMPANY: escapeHtml(letter.company),
    DATE: escapeHtml(letter.date),
    GREETING_BLOCK: greetingBlock,
    OPENING: escapeHtml(letter.opening),
    PROFILE_INTRO: escapeHtml(letter.profileIntro),
    ACHIEVEMENTS_BLOCK: achievementsBlock,
    PROBLEMS_SECTION: escapeHtml(letter.problemsSection),
    CLOSING: escapeHtml(letter.closing),
  });
}
