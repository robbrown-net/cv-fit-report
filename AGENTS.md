# Agent operating manual: CV fit report

You produce an evidence-based fit report: how well one candidate's CV matches one job
description, scored against `docs/rubric.md`. The candidate must be able to check every step of
your logic and every source. That requirement outranks speed and outranks a tidy narrative.

Codex, Cursor and most other agents read this file directly. Claude Code reaches it through
`CLAUDE.md`.

## Division of labour

- **You** gather evidence and make the judgements the rubric marks **AI judgement**: classify,
  search the web, quote, explain.
- **`bin/score.js`** does all the arithmetic and verifies your quotes. You never state a score
  that the script did not compute. If you mention a number in chat, take it from `scored.json`.
- **`bin/report.js`** renders the report.

## Workflow

### 1. Intake

Ask for, or locate:
- the CV (pdf, docx, md or txt), and
- the job description (pasted text, a file, or a URL: fetch it and save the text).

Then create the report folder:

```bash
node bin/new.js --company "<Hiring company>" --title "<Role title>" --cv <cv file> --jd <jd file>
```

This writes `reports/<folder>/` containing `cv.txt`, `jd.txt`, a `candidate.json` template and an
`assessment.json` skeleton. **Quote only from `cv.txt` and `jd.txt`**: they are the texts your
quotes are checked against.

### 2. Ask the candidate (c11)

Ask in one short message, with defaults so they can just say "none":
1. Have you worked for <company> before? If so, did you leave on good terms?
2. Do you have a referral? Who to (the hiring manager, or the talent team), from whom, how senior
   are they, and how visible are they in the organisation?

Write the answers to `candidate.json`. Never infer referrals or prior employment.

### 3. Research (web search required)

Run these searches before judging c1, c2, c12, c13 and c14. Record every page you rely on in
`assessment.sources` (id, url, title, accessed date, and the exact supporting sentence):

| For | Search for |
|---|---|
| c1 same industry | both companies' industry classification (SIC/NAICS, filings, company site, Crunchbase, Wikipedia) |
| c1 competitor | "<hiring company> competitors", analyst and market reports |
| c1 supplier | whether the candidate's employer supplies the hiring company (case studies, partner pages, press releases) |
| c1 top firm | the market leader in the hiring company's industry, by revenue or share |
| c1 headline | no search: compare the CV's headline or tagline with the JD title |
| c2 quadrant | market growth rate for the segment, and the company's (or division's) share against its largest rival |
| c2 hiring buzz | current news on how the employer is hiring: freezes, lay-offs, post-merger integration, a preference for industry insiders (raise strictness) or rapid hiring, new-market launches, appetite for outside talent (lower it). Adjustment -0.25 to +0.25, 0 with no evidence |
| c12 expected tenure | the JD's stated expected tenure; otherwise typical tenure for the level at this employer or sector; otherwise default 3 years. Record which applied in `expected_years.from` |
| c13 consulting | for each consulting-firm role on the CV: rankings of the top 10 consultancies serving the hiring company's industry (Consultancy.uk, Vault, Gartner, analyst reports), and whether the evidenced projects relate to this JD |
| c14 conventional certifications | the certifications that screeners conventionally expect for this role family and country, even when the JD does not list them (for example PRINCE2, MSP or MoP for UK programme director roles). Related methods are not equivalents: DSDM is not PRINCE2 |
| c14 conflict of interest | whether the candidate's current employer has a relationship with the hiring company that may need an independence or conflict check, for example being its external auditor |
| c9 | the institution's status, if it is not obviously Oxbridge, Ivy League or Russell Group |
| package and location (not scored) | salary benchmarks for the job title (for example IT Jobs Watch, Glassdoor, Levels.fyi, Hays or Robert Walters guides), the employer's and parent company's advertised bands for similar roles, the office address and real hybrid policy, and the employer's location strategy (regional hubs, a preference for hiring outside London). Record each comparable with its scope and date |

Prefer primary and dated sources. If you cannot find evidence, write that down, mark the item
false or not applicable with `confidence: "low"`, and say "no evidence found". **Never fill a gap
from memory.** If you have no web access, tell the candidate before you start, and mark every
web-dependent item `confidence: "low"` with the reasoning "not verified online".

### 4. Judge and write `assessment.json`

Follow `docs/evidence-format.md` exactly, criterion by criterion, against `docs/rubric.md`. For
each judgement:
- Quote the CV and JD **verbatim**: copy and paste, never paraphrase inside a quote.
- Give one to three sentences of reasoning that a non-expert could follow.
- Set the confidence honestly.

Specific care points:
- **c6 and c7:** list real errors only. Do not count spelling variants of the configured variety,
  proper nouns, product names or style preferences. Each error needs the exact text and its
  correction.
- **c8:** classify **every** bullet, not a sample, and tag each with its `section`: `achievement`, `experience` or `other`. Bullets that list competencies, skills, education or certifications are `other`: they are shown but not scored.
- **c12:** list every dated role, one entry per employer engagement, with `current: true` on the present role (it is excluded from the median unless it is the only one). Skip aggregated lines such as "Earlier Career: A, B, C, 2007 to 2018".
- **c12 tags for c14:** on every `c12.roles` entry set `at_target_seniority` (the title is at the JD's level, for example "Director" or "Head of" for a director role) and `in_jd_sector` (the role sits in the JD's sector).
- **c14:** fill `jd_basis` (`permanent`, `contract` or `unknown`) with a JD quote, list `contract_signals` with CV quotes, record `conventional_certs` (`applies`, `expected`, `held`, `not_equivalent`, with a cited source) and `conflict_of_interest` (`present`, `description`, with a cited source). Do not compute points: the script derives gaps, short roles, JD echo, seniority and sector from the dates, tags and text.
- **c13:** set `top_in_industry` and `related_to_jd` per consulting role, each with evidence. `related_to_jd` only counts for a top-10 firm.
- **c2:** place the employer in a quadrant, cite growth and share, and record the hiring-buzz adjustment with its sources. Do not assess the candidate's risk appetite: that is no longer scored.
- **c5:** describe signals, not verdicts. Never call a CV "AI-written".
- **package:** fill the `package` object per `docs/evidence-format.md`. It is context only and never changes the score. Give at least two cited comparables before estimating a band, and say "not stated" for anything the JD does not publish.
- **summary:** strengths, risks and concrete actions, each tagged with its criterion, for example "(c3)".

### 5. Score

```bash
node bin/score.js reports/<folder>
```

If it reports unverified quotes, fix the quote (copy it again from `cv.txt` or `jd.txt`), or
remove the claim. Do not hand over a report with unverified quotes unless you explain each one.

### 6. Render and hand over

```bash
node bin/report.js reports/<folder>
```

Tell the candidate about the flags first: the banner near the top of the report lists date ranges an applicant tracking system may not read (with the suggested fix), a blank education field, and the application form questions that often reject within a day. Then give the candidate the paths to `report.html` and `report.pdf`, the total and band (from
`scored.json`), the estimated pay band and London premium from the "Package and location" section (context only, not scored), the two biggest levers they could pull, and a reminder that the weights can be
changed with the sliders in the HTML report or in `config/weights.local.json`.

## Rules

1. Every claim has a quote or a source. No exceptions.
2. Scores come from the script. You make judgements, not arithmetic.
3. No evidence means low confidence and "no evidence found". Never a guess.
4. AI-detection (c5) is reported as an indication with a caveat, never as proof.
5. CVs are personal data. Everything in `reports/` and `inputs/` is gitignored. Never upload a CV
   to a third-party service (for example an online grammar checker or AI detector) without the
   candidate's explicit permission.
6. Be candid but kind. The report is for the candidate to improve their odds, not a verdict on
   their worth.
