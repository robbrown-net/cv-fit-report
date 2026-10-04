# Scoring rubric

This is the whole logic of the report. The candidate should be able to take any number in a
report, open this file, and recompute it by hand from the evidence shown. The AI's job is to
gather the evidence and make the judgements marked **AI judgement**. `bin/score.js` does all
the arithmetic, so the AI never states a final score itself.

All weights and point values below are defaults from `config/weights.json`. The candidate can
override them in `config/weights.local.json` or with the sliders in the HTML report.

## Total

```
core      = sum(weight_i * score_i) / sum(weight_i)     over c1, c3..c10, c12; each score_i in 0-100
gamma     = 0.5 + strictness                           (c2: from the employer's BCG position)
adjusted  = 100 * (core / 100) ^ gamma
bonus     = c11 points + c13 points + c14 points (c11 and c14 may be negative)
total     = clamp(adjusted + bonus, 0, 100)
```

Default core weights: c1 = 50, and the other nine scored criteria (c3 to c10, plus c12) share
the remaining 50 equally (50/9, about 5.56 each). c2 is not a weighted criterion: it sets how
harshly the employer treats any gap between the CV and the job description.

A criterion the AI could not assess (for example no JD tools listed for c3) is marked
`not_applicable`. Its weight is then dropped and the rest are renormalised. That is shown in
the report, never hidden.

## c1. Current or most recent role (default weight 50)

Uses the candidate's current role, or their most recent if they are between roles. Six
sub-checks. Sub-weights are 1 each by default, except `headline`, which is 0.25:

| Sub-check | Score | AI judgement needed |
|---|---|---|
| `title` | exact 100, close 70, adjacent 40, none 0 | yes: compare the **most recent job title actually held** with the JD title |
| `headline` | exact 100, close 70, adjacent 40, none 0 | yes: compare the CV's headline or tagline (the positioning line under the name) with the JD title. It should match, but it is a claim rather than a role held, so it carries a small weight |
| `same_industry` | 100 or 0 | yes: **web search** for both companies' industry classification (for example SIC/NAICS codes, company filings, Crunchbase, Wikipedia), and cite it |
| `competitor` | 100 or 0 | yes: **web search** the hiring company's competitor landscape. 100 if the current employer is a named competitor |
| `supplier` | 100 or 0 | yes: **web search** for evidence that the current employer supplies a product or service the hiring company uses (case studies, press releases, partner pages) |
| `top_firm` | 100 or 0 | yes: **web search** for the market leader by revenue or share in the hiring company's industry. 100 if the candidate has *ever* worked there |

`c1 = weighted mean of the six sub-scores`. (Consulting experience is scored as bonus points
in c13.)

Every sub-check that relies on web search must cite at least one source (URL, title, date
accessed, and the supporting sentence quoted). If no source can be found, the sub-check scores
0 with `confidence: low` and the report says "no evidence found". It never guesses.

## c2. Employer strictness: BCG growth-share position (modifier, not weighted)

The employer's market position predicts how closely a CV has to match the job description's
ideal. A Cash Cow protects a profitable franchise and hires for a perfect match. A Dog has
little to lose and will take a chance on fresh eyes.

1. **AI judgement + web search:** place the hiring company, or the division or product the role
   sits in where that is identifiable, in a quadrant. Cite the market growth rate and the
   relative market share (the company's share divided by its largest rival's).
   - High growth: market growth above 10 per cent a year (state the figure used).
   - High share: relative share of 1.0 or more.
2. Base strictness: `cash_cow 1.0, star 0.75, question_mark 0.5, dog 0.25`.
3. **AI judgement + web search: hiring buzz.** Adjust by -0.25 to +0.25, based on current
   reporting about how the employer is hiring. Raise strictness for hiring freezes, lay-offs,
   post-merger integration or a known preference for proven industry insiders. Lower it for
   rapid hiring, new-market launches, or a stated appetite for outside talent. Cite every
   source. With no evidence, the adjustment is 0.
4. `strictness = clamp(base + buzz, 0.25, 1.25)`, `gamma = 0.5 + strictness`, and
   `adjusted = 100 * (core/100) ^ gamma`.

Worked example: with a core of 70, a Cash Cow (gamma 1.5) gives 58.6, and a Dog (gamma 0.75)
gives 76.5. A core of 100 stays at 100 in every quadrant.

## c3. Years with the JD's tools, services and suppliers (default 5.56)

1. **AI judgement:** list every named tool, platform, service or supplier in the JD (for
   example Salesforce, AWS, SAP, Workday, ServiceNow), each with its JD quote and any years
   required (otherwise use the default of 3).
2. For each one, find the CV roles where it appears (quote them) and sum the months of those
   roles. Overlapping roles count once.
3. Item score = `min(years / required, 1) * 100`.
4. `c3 = mean of item scores`. If the JD names no tools, c3 is `not_applicable`.

## c4. AI experience and outcomes (default 5.56)

**AI judgement:** list each use of AI evidenced in the CV, with its quote, its outcome category
(`innovation`, `cost_saving`, `time_to_market`, `revenue_growth`, `risk_reduction`,
`customer_satisfaction`, `colleague_engagement`, `communication`, `other`), and whether the
outcome is quantified.

```
breadth = min(distinct categories / 4, 1) * 50
depth   = min(quantified uses / 3, 1) * 30
tenure  = min(years using AI / 3, 1) * 20
c4 = breadth + depth + tenure
```

## c5. Likelihood that the CV was AI-generated (default 5.56)

**AI judgement, labelled as an indication and never as proof.** Estimate a likelihood from 0
to 100 from listed signals, each with a quote. Example signals: stock AI phrasing ("spearheaded",
"leveraged", "proven track record", "dynamic"), uniform bullet length and rhythm, generic claims
with no specific numbers, American spelling in an otherwise British CV, or the reverse.

- `direction: "negative"` (default): `c5 = 100 - likelihood`.
- `direction: "positive"`: `c5 = likelihood`. Use this when the employer rewards AI fluency.

The report always shows the caveat that AI detection is unreliable.

## c6. Spelling (default 5.56)

**AI judgement:** list every spelling error with the exact word as it appears, the line, and the
correction. Spelling variants in the configured variety (en-GB by default) are not errors, and
nor are proper nouns or product names. `c6 = max(0, 100 - 5 * errors)`.

## c7. Grammar (default 5.56)

Same as c6, for grammar: agreement, tense consistency, missing articles, run-ons, misplaced
modifiers and punctuation that changes the meaning. Style preferences are not errors.
`c7 = max(0, 100 - 5 * errors)`.

## c8. STAR or Problem-Action-Result bullets (default 5.56)

**AI judgement:** classify every **achievement and experience** bullet in the CV as `full` (situation or problem, action and
result all present), `partial` (action and result, or action and a vague result) or `none`. Each
classification lists which parts were found. Tag every bullet with its `section`
(`achievement`, `experience` or `other`). Bullets that list competencies, skills, education or
certifications are `other`: they are shown in the report but not scored.
`c8 = mean(full 1, partial 0.5, none 0) * 100`, over achievement and experience bullets only.

## c9. Top university (default 5.56)

**AI judgement + web search where unsure:** take the best institution the candidate graduated
from. Score: Oxbridge 100, Ivy League 100, Russell Group 80, comparable top institution
(top 100 in QS or THE world rankings, cite which) 60, other 0. Graduation must be evidenced in
the CV: attendance alone does not count.

## c10. Qualifications and certifications against the JD (default 5.56)

**AI judgement:** list each qualification or certification the JD asks for (required or
desirable), mark it `met`, `partial` (equivalent or related) or `not_met`, and quote the CV
evidence. Required items count double. `c10 = weighted mean * 100`. If the JD asks for none,
c10 is `not_applicable`.

## c11. Candidate's own access (bonus points, added after the adjusted score)

Self-reported by the candidate in `candidate.json`. The AI asks for it and never infers it.

| Item | Default points |
|---|---|
| Previously worked for the hiring organisation | +5 (set `direction: "negative"` for -5, for example if they left on poor terms) |
| Referral to the hiring manager by a trusted influencer | +10 |
| Referral to talent by a colleague in the same division | junior +3, mid +5, senior +7, executive +9 |
| Referral to talent by another colleague | junior +2, mid +3, senior +5, executive +7, times visibility (low 0.75, medium 1, high 1.25) |

All the referrals that apply are added together.

## c12. Tenure against the employer's expected longevity (default 5.56)

Employers hire for longevity: a director role usually expects three to five years. A CV made up
of short engagements counts against the candidate on a sliding scale.

1. **AI judgement:** expected years, taken from the JD if it is stated, otherwise from cited
   research on the employer or role (for example typical tenure for the level), otherwise the
   default of 3. Record which applied.
2. List every role the CV dates, one entry per employer engagement, with its quote. Where one
   entry names several employers under a single date range (for example "Ford & Worldpay,
   Jun 2019 - May 2022"), set `employer_count` to the number of employers: it counts as that
   many roles, each lasting the entry's tenure divided equally between them. Where the entry
   ends "& others" (for example "Earlier Career: A, B, C & others, 1994 to 2015"), also set
   `has_others`: the named employers share 60 per cent of the tenure equally, and "others" counts
   as one more role lasting the remaining 40 per cent (`c12_others_share`, default 0.4).
   Dates given as years only start in January and end in the month before the next role
   starts (or in December if no later role starts that year). Record the assumption in the
   reasoning.
3. Tenure in months is counted inclusively, the same way as c3. The current role is excluded,
   because it is unfinished, unless it is the only role.
4. `c12 = min(median tenure / (expected years * 12), 1) * 100`.

## c13. Consulting experience (bonus points)

**AI judgement + web search:** for each role at a consulting firm, decide:
- `top_in_industry`: whether the firm ranks in the top 10 consultancies serving the hiring
  company's industry (cite a ranking such as Consultancy.uk, Vault, Gartner or an analyst
  report). Worth +3.
- `related_to_jd`: whether the role's evidenced projects relate to what this JD is hiring for
  (quote the CV and the JD). Worth +3 more, and only for a top-10 firm.

c13 is capped at +10 by default.

## c14. Screening signals (plus and minus points)

Automated screeners reject many CVs within hours, before a person reads them. These items
model what such systems commonly check. The script computes every item it can from dates and
text, so the candidate can check the arithmetic exactly. c14 is clamped between -15 and +10.

| Item | Points (default) | How it is decided |
|---|---|---|
| Target seniority | +5 if 3 or more years, 0 if under 3, -5 if none | **AI judgement:** tag each `c12.roles` entry `at_target_seniority` (its title is at the JD's level, for example "Director" or "Head of" for a director role). The script sums dated months of tagged roles within the last 10 years. |
| Employment gaps | -3 per gap over 6 months, capped at -9 | Script: gaps between consecutive dated roles in `c12.roles` within the last 10 years. |
| Short recent roles | -3 for each of the two most recent roles (including the current one) that lasted, or has lasted, under 12 months | Script, from `c12.roles`. |
| Contract history | -3 if the JD is permanent and the CV shows contract signals; +2 if the JD is a contract role and the CV shows contract experience | **AI judgement:** `jd_basis` with a JD quote, and `contract_signals` with CV quotes. |
| JD echo | -1 for each copied phrase beyond the first 3, capped at -5 | Script: distinct runs of 6 or more consecutive words that appear in both the CV and the JD (case and punctuation ignored). Each phrase is listed in the report. |
| Sector recency | +2 if the current role is in the JD's sector; -2 if the last in-sector role ended 1 to 3 years ago; -4 if more than 3 years ago or never | **AI judgement:** tag each `c12.roles` entry `in_jd_sector`. The script measures from the end of the latest tagged role. |
| Conventional certifications | +2 if held, -2 if missing | **AI judgement + web search:** the certifications screeners conventionally expect for this role family, even when the JD does not list them (for example PRINCE2, MSP or MoP for UK programme director roles). Cite a source. Related methods do not count as equivalents: DSDM is not PRINCE2. |
| Conflict of interest | -3 | **AI judgement + web search:** the candidate's current employer has a relationship that may require an independence or conflict check, such as being the hiring company's external auditor. Cite the source. |

### Report flags (no points)

- **Date ranges a parser may not read:** the script lists every CV line with a date range
  written with "to" or a typographic dash instead of an ASCII hyphen, for example
  "Apr 2022 to Apr 2023". Many applicant tracking systems split ranges only on "-", so these
  roles may parse as zero months.
- **Education with no institution:** shown when c9 has no institution.
- **Application form knockouts:** a fixed checklist, always shown: salary expectation, notice
  period, right to work, current job title, and yes/no experience questions. These often
  cause rejections within a day, and the CV cannot show them.

## Package and location (not scored)

Context for the candidate's decision, shown in its own section of the report. It never changes
the score.

1. **Posted package:** the salary, day rate, bonus and benefits as the JD states them, with JD
   quotes. Anything not published is "not stated".
2. **AI judgement + web search: expected band.** Where the salary is not published, estimate a
   low and a high from at least two cited comparables: salary benchmarks for the same job title
   (for example IT Jobs Watch, Glassdoor, Levels.fyi, Hays or Robert Walters salary guides),
   the employer's own advertised bands for similar roles, and the parent company's bands. Each
   comparable records its figure, its scope (London, UK excluding London, UK, remote) and its
   date. The script computes the midpoint, and the London premium where both a London and a
   UK-excluding-London figure exist.
3. **AI judgement + web search: location.** The office address, the real work pattern (office,
   hybrid with N days, fully remote), and the commuting reality for the candidate's location.
4. **AI judgement + web search: employer location strategy.** Whether the employer, or its
   parent, is moving roles or hiring away from high-cost cities such as London (regional hubs,
   relocations, remote-first policies), and what that means for this role's pay and future.
5. **Contract basis effects:** for a fixed-term contract, note what usually differs (bonus,
   equity, notice, renewal) and the permanent-equivalent comparison.

## Evidence verification (done by `bin/score.js`)

- Every `cv_quotes[].text` must appear in the CV text, and every `jd_quotes[].text` in the JD
  text. The match ignores case, whitespace and typographic quote differences. Each quote that
  fails is flagged **unverified** in red on the report, and the criterion's confidence drops to
  `low`.
- Every web source needs `url`, `title`, `accessed` (YYYY-MM-DD) and `quote`. A source with no
  URL is rejected.
- Scores are always computed by the script from the judgements, so a hand-typed score in the
  evidence file is ignored.
