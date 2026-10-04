# Evidence format

Each assessment lives in `reports/<YYYYMMDD>-<company>-<title>/`:

```
cv.txt            CV text, extracted by bin/extract.js (the text that quotes are checked against)
jd.txt            job description text
candidate.json    the candidate's self-reported answers (c11: prior employment and referrals)
assessment.json   the AI's evidence and judgements (written by the agent, shape below)
scored.json       written by bin/score.js: verification results, every sub-score and the total
report.html       written by bin/report.js: self-contained, with interactive weights
report.pdf        written by bin/report.js
```

## Shared shapes

```jsonc
// Quote: verified verbatim against cv.txt or jd.txt
{ "text": "Head of Operations, Example Payments Ltd" }

// Source: a web page used for a judgement
{ "id": "S1", "url": "https://...", "title": "Page title", "accessed": "2026-10-04",
  "quote": "the sentence on that page that supports the claim" }

// Evidence: attached to every judgement
{ "cv_quotes": [Quote], "jd_quotes": [Quote], "source_ids": ["S1"],
  "reasoning": "one to three plain sentences a candidate can follow",
  "confidence": "high | medium | low" }
```

## candidate.json

```jsonc
{
  "name": "Alex Morgan",
  "previously_worked_here": { "value": false, "direction": "positive", "note": "" },
  "referrals": [
    // type: "hiring_manager_trusted_influencer" | "same_division_colleague" | "colleague"
    // seniority: junior|mid|senior|executive (colleague types); visibility: low|medium|high ("colleague" only)
    { "type": "colleague", "seniority": "senior", "visibility": "high", "note": "ex-manager, now COO's chief of staff" }
  ]
}
```

## assessment.json

```jsonc
{
  "meta": {
    "candidate": "Alex Morgan",
    "hiring_company": "Acme Corp",
    "role_title": "Head of Operations",
    "division_or_product": "Payments division",   // or null
    "assessed_on": "2026-10-04",
    "assessed_by": "Claude / Codex / Cursor + model name"
  },
  "sources": [Source],
  "current_role": { "title": "...", "employer": "...", "start": "2021-03", "end": null, "evidence": Evidence },

  "c1": {
    "title":            { "level": "exact|close|adjacent|none", "evidence": Evidence },
    "same_industry":    { "match": true,  "candidate_industry": "...", "hiring_industry": "...", "evidence": Evidence },
    "competitor":       { "match": false, "competitors_considered": ["..."], "evidence": Evidence },
    "supplier":         { "match": false, "products_or_services": ["..."], "evidence": Evidence },
    "headline":         { "level": "exact|close|adjacent|none", "evidence": Evidence },
    "top_firm":         { "match": false, "top_firm": "...", "evidence": Evidence }
  },
  "c2": {
    "quadrant": "cash_cow|star|question_mark|dog",
    "market_growth_pct": 4.5, "relative_share": 1.3,
    "unit_assessed": "company|division|product",
    "evidence": Evidence,
    "buzz": { "adjustment": 0.1,                   // -0.25 to +0.25; 0 with no evidence
              "summary": "post-merger integration and announced job cuts",
              "evidence": Evidence }
  },
  "c3": {
    "not_applicable": false,
    "items": [
      { "name": "Salesforce", "required_years": null, "jd_quote": Quote,
        "cv_roles": [ { "employer": "...", "start": "2019-01", "end": "2021-02", "quote": Quote } ] }
    ]
  },
  "c4": {
    "years_using_ai": 2,
    "uses": [ { "description": "...", "category": "cost_saving", "quantified": true, "quote": Quote } ],
    "evidence": Evidence
  },
  "c5": {
    "likelihood": 35,
    "signals": [ { "signal": "stock phrasing", "quote": Quote, "weight": "weak|moderate|strong" } ],
    "evidence": Evidence
  },
  "c6": { "variant": "en-GB", "errors": [ { "quote": Quote, "correction": "...", "line": 12 } ] },
  "c7": { "errors": [ { "quote": Quote, "correction": "...", "rule": "subject-verb agreement", "line": 30 } ] },
  "c8": { "bullets": [ { "quote": Quote, "section": "achievement|experience|other", "level": "full|partial|none",
                         "parts": { "situation": true, "action": true, "result": true } } ] },
  "c9": { "institution": "University of Example", "tier": "russell_group", "graduated": true, "evidence": Evidence },
  "c10": {
    "not_applicable": false,
    "items": [ { "requirement": "PMP or equivalent", "required": true, "status": "met|partial|not_met",
                 "jd_quote": Quote, "evidence": Evidence } ]
  },
  "c12": {
    "expected_years": { "value": 3, "from": "jd|research|default", "evidence": Evidence },
    "roles": [ { "employer": "...", "title": "...", "start": "2019-06", "end": "2020-05",
                 "current": false, "employer_count": 1,   // number of NAMED employers in the entry
                 "at_target_seniority": false,            // c14: title at the JD's level
                 "in_jd_sector": false,                   // c14: role sits in the JD's sector
                 "has_others": false,                     // true when the entry ends "& others"
                 "quote": Quote } ],
    "evidence": Evidence
  },
  "c13": {
    "firms_considered": ["..."],
    "roles": [ { "employer": "PwC", "title": "...", "top_in_industry": true, "related_to_jd": false,
                 "quote": Quote, "evidence": Evidence } ]
  },
  "c14": {
    "jd_basis": "permanent|contract|unknown", "jd_basis_evidence": Evidence,
    "contract_signals": [ { "quote": Quote, "note": "..." } ],
    "conventional_certs": { "applies": true, "expected": ["PRINCE2", "MSP"], "held": [],
                            "not_equivalent": ["DSDM Atern"], "evidence": Evidence },
    "conflict_of_interest": { "present": false, "description": "", "evidence": Evidence }
  },
  "summary": {
    "strengths": ["..."],               // each strength names the criterion it comes from, e.g. "(c1)"
    "risks": ["..."],
    "actions": ["what the candidate could change before applying"]
  }
}
```

The agent never writes a score field. `bin/score.js` computes all of them.

## scored.json (written by bin/score.js)

```jsonc
{
  "meta": {...}, "weights_used": {...}, "weights_file": "config/weights.json",
  "verification": { "quotes_total": 84, "quotes_unverified": 1,
                    "unverified": [ { "path": "c4.uses[2].quote", "text": "..." } ],
                    "sources_rejected": [] },
  "criteria": {
    "c1": { "score": 61.7, "weight": 50, "not_applicable": false, "confidence": "medium",
            "working": "mean(title 70, same_industry 100, competitor 0, ...) = 61.7",
            "sub": { "title": 70, "same_industry": 100, ... } },
    "...": {}
  },
  "core": 58.2,
  "strictness": { "quadrant": "star", "base": 0.75, "buzz": 0.1, "strictness": 0.85, "gamma": 1.35 },
  "adjusted": 48.1,
  "bonus": { "items": [ { "label": "...", "points": 5, "group": "c11|c13|c14" } ], "c11": 5, "c13": 3, "c14": 0, "total": 8 },
  "c14": { "items": [ { "key": "gaps", "label": "...", "points": -3, "working": "...", "evidence_paths": [] } ],
           "total": -3, "flags": { "ats_dates": [ { "line": 12, "text": "...", "matches": [ { "found": "Apr 2022 to Apr 2023", "fix": "Apr 2022 - Apr 2023" } ] } ],
                                  "education_blank": false, "form_checklist": ["..."] }, "echo_phrases": ["..."] },
  "total": 56.1, "band": "Strong | Competitive | Stretch | Long shot"
}
```

Bands: Strong 75 and above, Competitive 60-74, Stretch 45-59, Long shot under 45.
