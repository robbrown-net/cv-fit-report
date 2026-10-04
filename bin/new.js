#!/usr/bin/env node
'use strict';
// Usage: node bin/new.js --company "Acme Corp" --title "Head of Operations" --cv <file> --jd <file|->
const fs = require('fs');
const path = require('path');
const { extractText } = require('./extract');

const ROOT = path.resolve(__dirname, '..');

function slug(s) {
  return String(s).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function ev() { return { cv_quotes: [], jd_quotes: [], source_ids: [], reasoning: '', confidence: 'medium' }; }

function skeleton(company, title, today) {
  return {
    meta: { candidate: null, hiring_company: company, role_title: title, division_or_product: null, assessed_on: today, assessed_by: null },
    sources: [],
    current_role: { title: null, employer: null, start: null, end: null, evidence: ev() },
    c1: {
      title: { level: null, evidence: ev() },
      headline: { level: null, evidence: ev() },
      same_industry: { match: false, candidate_industry: null, hiring_industry: null, evidence: ev() },
      competitor: { match: false, competitors_considered: [], evidence: ev() },
      supplier: { match: false, products_or_services: [], evidence: ev() },
      top_firm: { match: false, top_firm: null, evidence: ev() }
    },
    c2: {
      quadrant: null, market_growth_pct: null, relative_share: null, unit_assessed: null, evidence: ev(),
      buzz: { adjustment: 0, summary: '', evidence: ev() }
    },
    c3: { not_applicable: false, items: [] },
    c4: { years_using_ai: null, uses: [], evidence: ev() },
    c5: { likelihood: null, signals: [], evidence: ev() },
    c6: { variant: 'en-GB', errors: [] },
    c7: { errors: [] },
    c8: { bullets: [] },
    c9: { institution: null, tier: null, graduated: null, evidence: ev() },
    c10: { not_applicable: false, items: [] },
    c12: { expected_years: { value: 3, from: 'default', evidence: ev() }, roles: [], evidence: ev() },
    c13: { firms_considered: [], roles: [] },
    c14: {
      jd_basis: 'unknown', jd_basis_evidence: ev(), contract_signals: [],
      conventional_certs: { applies: false, expected: [], held: [], not_equivalent: [], evidence: ev() },
      conflict_of_interest: { present: false, description: '', evidence: ev() }
    },
    summary: { strengths: [], risks: [], actions: [] }
  };
}

async function main() {
  const args = process.argv.slice(2);
  const o = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) o[args[i].slice(2)] = args[++i];
  }
  if (!o.company || !o.title || !o.cv || !o.jd) {
    console.error('usage: node bin/new.js --company "Acme Corp" --title "Head of Operations" --cv <file> --jd <file|->');
    process.exit(2);
  }
  const cs = slug(o.company), ts = slug(o.title);
  if (!cs || !ts) { console.error('error: company and title must contain letters or digits'); process.exit(2); }
  if (!fs.existsSync(o.cv)) { console.error('error: no such CV file: ' + o.cv); process.exit(2); }
  if (o.jd !== '-' && !fs.existsSync(o.jd)) { console.error('error: no such JD file: ' + o.jd); process.exit(2); }

  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const dir = path.join(ROOT, 'reports', today.replace(/-/g, '') + '-' + cs + '-' + ts);
  if (fs.existsSync(dir)) { console.error('error: ' + dir + ' already exists'); process.exit(3); }

  const cvText = await extractText(o.cv);
  const jdText = o.jd === '-' ? fs.readFileSync(0, 'utf8') : await extractText(o.jd);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cv.txt'), cvText);
  fs.writeFileSync(path.join(dir, 'jd.txt'), jdText);
  const candidate = {
    name: null,
    previously_worked_here: { value: false, direction: 'positive', note: '' },
    referrals: []
  };
  fs.writeFileSync(path.join(dir, 'candidate.json'), JSON.stringify(candidate, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'assessment.json'), JSON.stringify(skeleton(o.company, o.title, today), null, 2) + '\n');
  console.log(dir);
}

main().catch((e) => { console.error('error: ' + e.message); process.exit(1); });
