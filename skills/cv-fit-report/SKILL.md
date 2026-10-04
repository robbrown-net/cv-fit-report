---
name: cv-fit-report
description: Produce an evidence-based CV-versus-job-description fit report (weighted score, verified quotes, cited web sources, HTML + PDF). Use when someone shares a CV and a job description and asks how well they match, what their chances are, or for a fit/gap assessment.
---

# CV fit report

Follow the workflow in `AGENTS.md` at the repo root, step by step:

1. Intake: `node bin/new.js --company ... --title ... --cv ... --jd ...`
2. Ask the candidate about prior employment and referrals (c11). Do not ask about risk appetite.
3. Research with web search (industry, competitors, suppliers, market leader, BCG growth and
   share, hiring buzz for c2, expected tenure for c12, top consulting firms for c13, conventionally expected certifications and conflicts of interest for c14), recording
   every source with the exact supporting sentence.
4. Write `assessment.json` per `docs/evidence-format.md`, judging against `docs/rubric.md`.
   Quote `cv.txt` and `jd.txt` verbatim. Tag every c8 bullet with its section (achievement, experience
   or other), list c12 roles with `current` set, set c13 `top_in_industry` / `related_to_jd`, tag every c12 role `at_target_seniority` and `in_jd_sector`, and fill c14 (`jd_basis`, `contract_signals`, `conventional_certs`, `conflict_of_interest`). Also fill the unscored `package` object (posted package, estimated band from cited comparables, location, location strategy).
5. `node bin/score.js reports/<folder>`: fix any unverified quotes.
6. `node bin/report.js reports/<folder>`: tell the candidate about the flags first (date ranges a screening system may not read, blank education, application form questions), then hand over report.html and report.pdf.

Never state a score that `bin/score.js` did not compute. Never fill a gap from memory: no
evidence means low confidence and "no evidence found".
