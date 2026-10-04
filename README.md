# cv.fit-report

How well does this CV fit this job, and **why**? An AI-assisted report that scores a CV against a
job description on ten weighted criteria, adjusted for how strict the employer is, plus bonus and screening points. Every judgement is backed by a
verbatim quote or a cited web source, and every number can be recomputed by hand.

Works with **Claude Code**, **Codex**, **Cursor**, or any agent that reads `AGENTS.md`.

## Read your score as a hypothesis, not a verdict

The score is a hypothesis about how this CV will land with this employer. It is not a decision
about whether to apply.

- **A low score is not a reason to hold the CV back.** Send it anyway, and learn from what
  happens. A rejection, a silence or an unexpected call back tests the hypothesis and tells you
  which criteria matter to this employer.
- **A high score is not a guarantee.** It does not promise a call back, an interview or even
  feedback. Send the CV, and treat the outcome as evidence in exactly the same way.
- **A strong referral to the hiring manager overrides the score completely.** When someone
  the hiring manager trusts puts your name forward, the conversation no longer depends on how a
  screener reads your CV, so no assessed score should stop you.

Use the report to improve the CV before you send it, and to understand the outcome afterwards.
Every application is an experiment: record the score, send the CV, and compare the result with
the report.

## What it scores

| # | Criterion | Default weight |
|---|---|---|
| 1 | Current or most recent role: title match, CV headline match (small weight), same industry, competitor, supplier, ever at the market leader | 50% |
| 2 | Employer strictness from the hiring company's BCG growth-share quadrant plus hiring buzz. A modifier, not weighted: it sets the exponent that turns the core score into the adjusted score | modifier |
| 3 | Years with the tools, services and suppliers the JD names | 5.56% |
| 4 | AI experience, and the outcomes it delivered | 5.56% |
| 5 | Likelihood that the CV is AI-generated (penalty or bonus, your choice) | 5.56% |
| 6 | Spelling (minus points per error) | 5.56% |
| 7 | Grammar (minus points per error) | 5.56% |
| 8 | STAR or Problem-Action-Result shape, checked on every achievement and experience bullet | 5.56% |
| 9 | Top-university graduate (Oxbridge, Ivy League, Russell Group or similar) | 5.56% |
| 10 | Qualifications and certifications against the JD | 5.56% |
| 11 | The candidate's own access: previously worked there, referrals by route and seniority | bonus points |
| 12 | Tenure: median length of completed roles against the employer's expected longevity | 5.56% |
| 13 | Consulting experience: roles at top-10 firms for the industry, more if the work relates to the JD (capped at +10) | bonus points |
| 14 | Screening signals: time at the target seniority, employment gaps, short recent roles, contract history, phrases copied from the JD, sector recency, conventional certifications and conflicts of interest (clamped between -15 and +10). The report also flags date ranges an applicant tracking system may not read, a blank education field and application form questions | plus and minus points |

The report also has an unscored "Package and location" section: the posted package, an estimated pay band with cited comparables, the London premium, the work pattern and the employer's location strategy. It never changes the score.

`total = clamp(adjusted + c11 + c13 + c14, 0, 100)`, where `adjusted = 100 * (core/100)^gamma` and gamma comes from c2.
The full logic, with every formula, is in [docs/rubric.md](docs/rubric.md). Change any weight in
`config/weights.local.json`, or live with the sliders in the HTML report.

## How it stays honest

- **The AI judges, the script counts.** The agent writes evidence and judgements to
  `assessment.json`. `bin/score.js` computes every score, so the AI never asserts a number.
- **Quotes are verified.** Every CV or JD quote is checked against the extracted text, and one
  that is not there is flagged in red on the report.
- **Sources are cited.** Industry, competitor, supplier, market-leader, consulting and BCG
  judgements need web sources, each with the URL, the date accessed and the supporting sentence.
- **No evidence means no points**, marked low confidence. It is never a guess.

## Quick start

```bash
git clone https://github.com/robbrown-net/cv.fit-report.git
cd cv.fit-report
npm install
```

Open the folder in your agent and say:

> Assess my CV against this job. *(attach or paste both)*

The agent follows [AGENTS.md](AGENTS.md): intake, a couple of questions about referrals,
web research, evidence, scoring, then `report.html` and `report.pdf` in `reports/<folder>/`.

Requirements: Node.js 18 or later, and an agent with web search, which industry and market
judgements need.

## Example

[examples/acme-head-of-operations/](examples/acme-head-of-operations/) is a complete fictional
run: CV, JD, evidence file and the finished report.

```bash
node bin/score.js examples/acme-head-of-operations
node bin/report.js examples/acme-head-of-operations
```

## Privacy

CVs are personal data. `reports/` and `inputs/` are gitignored, and the agent is instructed never
to send a CV to a third-party service without permission.

## Caveats

- AI-detection (criterion 5) is unreliable everywhere. It is shown as an indication, never as proof.
- Criteria 1, 2, 9 and 13 depend on public information that may be dated or incomplete. Check the
  sources the report cites.
- This is a self-assessment aid, not a hiring decision tool.

## License

MIT
