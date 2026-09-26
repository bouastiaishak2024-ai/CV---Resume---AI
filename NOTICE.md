# Third-party attribution

This project adapts two things from **career-ops**
(https://github.com/career-ops-hq/career-ops), Copyright (c) 2026 Santiago
Fernández de Valderrama, licensed under the MIT License:

1. **`templates/cover-letter-template.html`** — adapted from career-ops's
   `templates/cover-letter-template.html`. The print CSS (page margins,
   ligature disabling for ATS text extraction) is carried over essentially
   unchanged; the config-driven style-token override block and
   Playwright-pipeline-specific comments were removed since they don't apply
   here. See the comment at the top of the file for specifics.

2. **Resume/cover-letter writing rules** in `functions/api/generate.js`'s
   system prompt — the no-fabrication rule, the "reformulate never invent"
   keyword-injection strategy with its exact examples, and the cover letter's
   style rules (active voice, no em dashes, banned buzzwords, concrete-metrics
   requirement, 350-420 word target) are adapted from career-ops's
   `modes/_shared.md` and `modes/cover.md`.

career-ops's MIT License text (reproduced per its terms):

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to
> deal in the Software without restriction, including without limitation the
> rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
> sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

career-ops itself is not used at runtime by this project — it is a local CLI
tool, not something this web backend calls or depends on. Only the two items
above were carried over, as static text embedded in this repository's own
files.
