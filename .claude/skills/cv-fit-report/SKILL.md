---
name: cv-fit-report
description: Produce an evidence-based CV-versus-job-description fit report (weighted score, verified quotes, cited web sources, HTML + PDF). Use when someone shares a CV and a job description and asks how well they match, what their chances are, or for a fit/gap assessment.
---

# CV fit report

Follow the workflow in `AGENTS.md` at the repo root, step by step:

1. Intake: `node bin/new.js --company ... --title ... --cv ... --jd ...`
2. Ask the candidate about prior employment, referrals and (later) their risk appetite.
3. Research with web search (industry, competitors, suppliers, market leader, top consulting
   firms, BCG growth and share), recording every source with the exact supporting sentence.
4. Write `assessment.json` per `docs/evidence-format.md`, judging against `docs/rubric.md`.
   Quote `cv.txt` and `jd.txt` verbatim.
5. `node bin/score.js reports/<folder>`: fix any unverified quotes.
6. `node bin/report.js reports/<folder>`: hand over report.html and report.pdf.

Never state a score that `bin/score.js` did not compute. Never fill a gap from memory: no
evidence means low confidence and "no evidence found".
