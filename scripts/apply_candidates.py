#!/usr/bin/env python3
"""
apply_candidates.py

Convert data/pending-review.json candidate entries into draft breach entries in data/breaches.json
and optionally minimal company entries in data/companies.json.

Usage:
  python scripts/apply_candidates.py --mode direct --dry-run false
  python scripts/apply_candidates.py --mode direct --dry-run true   # test without committing
"""

import argparse
import json
import os
import re
from datetime import datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
import shutil
import sys

ROOT = Path('.')
PENDING = ROOT / 'data' / 'pending-review.json'
BREACHES = ROOT / 'data' / 'breaches.json'
COMPANIES = ROOT / 'data' / 'companies.json'
AUTOMATED_AUDIT_DIR = ROOT / 'data' / 'automated-candidates'
AUTOMATED_AUDIT_DIR.mkdir(parents=True, exist_ok=True)

ID_RE = re.compile(r'[^a-z0-9\-]')

def load_json(p):
    if not p.exists():
        return None
    with p.open('r', encoding='utf-8') as f:
        return json.load(f)

def atomic_write(path: Path, obj):
    tmp = NamedTemporaryFile('w', delete=False, encoding='utf-8')
    tmp_name = tmp.name
    json.dump(obj, tmp, ensure_ascii=False, indent=2)
    tmp.close()
    shutil.move(tmp_name, str(path))

def sanitize_id(s, maxlen=120):
    s = s.lower()
    s = re.sub(r'\s+', '-', s)
    s = ID_RE.sub('-', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s[:maxlen]

def find_company_by_keyword(companies, keyword):
    k = keyword.lower()
    for c in companies:
        if c.get('id','').lower() == k or c.get('name','').lower() == k:
            return c['id']
        # also try substring match on name
        if k in c.get('name','').lower():
            return c['id']
    return None

def candidate_to_breach(candidate, companies_list):
    # Build a minimal draft breach entry
    suggested_id = candidate.get('suggested_id') or candidate.get('title','untitled')
    breach_id = sanitize_id(suggested_id)
    title = candidate.get('title') or ''
    discovered_at = candidate.get('discovered_at') or ''
    date = None
    if discovered_at:
        date = discovered_at[:10]
    # map matched keywords to company ids if possible
    matched = candidate.get('matched_keywords') or []
    companies_ids = []
    for kw in matched:
        mapped = find_company_by_keyword(companies_list, kw)
        if mapped:
            companies_ids.append(mapped)
        else:
            # create placeholder id
            placeholder_id = sanitize_id(kw)
            companies_ids.append(placeholder_id)
    # fallback: try to extract company-like token from suggested_id
    if not companies_ids:
        # if suggested_id contains company-like prefix, use first token
        token = breach_id.split('-')[0]
        if token:
            companies_ids.append(token)
    breach = {
        "id": breach_id,
        "title": title,
        "date": date or "",
        "companies": companies_ids,
        "data_types": [],
        "severity": "unverified",
        "source": candidate.get('source_url'),
        "added_by": "automated-pipeline",
        "discovered_at": discovered_at
    }
    return breach

def ensure_company_record(companies_obj, company_id, name_hint=None):
    # companies_obj is the top-level object with "companies" list
    existing = companies_obj.get('companies', [])
    if any(c.get('id') == company_id for c in existing):
        return False
    new = {
        "id": company_id,
        "name": name_hint or company_id,
        "website": "",
        "region": "",
        "type": "unknown",
        "description": "Auto-created from automated candidate; please verify and expand."
    }
    existing.append(new)
    companies_obj['companies'] = existing
    return True

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mode', choices=['direct'], default='direct', help='Operation mode: direct (push to default branch). PR mode not implemented in this script.')
    ap.add_argument('--dry-run', choices=['true','false'], default='true', help='If true, do not write files or make changes.')
    args = ap.parse_args()

    dry_run = args.dry_run == 'true'

    pending = load_json(PENDING)
    if not pending:
        print("No pending-review.json found or empty. Nothing to do.")
        return 0
    if not isinstance(pending, list) or len(pending) == 0:
        print("Pending review empty list. Nothing to do.")
        return 0

    breaches_obj = load_json(BREACHES)
    if breaches_obj is None:
        print("breaches.json missing or unreadable. Aborting.")
        return 2
    companies_obj = load_json(COMPANIES)
    if companies_obj is None:
        print("companies.json missing or unreadable. Aborting.")
        return 2

    existing_breaches = {b['id']: b for b in breaches_obj.get('breaches', [])}
    existing_companies = {c['id']: c for c in companies_obj.get('companies', [])}

    applied = []
    created_companies = []
    added_any = False

    for cand in pending:
        breach = candidate_to_breach(cand, companies_obj.get('companies', []))
        bid = breach['id']
        if bid in existing_breaches:
            print(f"Skipping existing breach id: {bid}")
            continue
        # ensure company records exist for each company id in breach
        for cid in breach.get('companies', []):
            if cid and cid not in existing_companies:
                # add minimal company
                name_hint = cid
                print(f"Will create company record: {cid}")
                if not dry_run:
                    ensure_company_record(companies_obj, cid, name_hint=name_hint)
                    existing_companies[cid] = True
                    created_companies.append(cid)
                else:
                    created_companies.append(cid)
        # append breach
        print(f"Will add breach: {bid}")
        if not dry_run:
            lst = breaches_obj.get('breaches', [])
            lst.append(breach)
            breaches_obj['breaches'] = lst
            existing_breaches[bid] = breach
            added_any = True
        applied.append({
            "candidate_id": cand.get('suggested_id'),
            "created_breach_id": bid,
            "source": cand.get('source_url')
        })

    # update last_updated field for breaches.json
    if added_any and not dry_run:
        today = datetime.utcnow().date().isoformat()
        breaches_obj['last_updated'] = today

    # write files if not dry-run
    if dry_run:
        print("Dry run mode: no files changed. Summary:")
        print(json.dumps({"applied": applied, "created_companies": created_companies}, indent=2))
        return 0

    # backup originals
    shutil.copy(BREACHES, BREACHES.with_suffix('.json.bak'))
    shutil.copy(COMPANIES, COMPANIES.with_suffix('.json.bak'))

    atomic_write(BREACHES, breaches_obj)
    atomic_write(COMPANIES, companies_obj)

    # write audit copy of original candidates and mapping
    audit_name = f'issue-applied-{datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")}.json'
    atomic_write(AUTOMATED_AUDIT_DIR / audit_name, {"applied": applied, "created_companies": created_companies, "original_candidates": pending})

    print("Applied candidates and updated files:")
    print(f" - {BREACHES}")
    print(f" - {COMPANIES}")
    print(f"Audit file: {AUTOMATED_AUDIT_DIR / audit_name}")

    return 0

if __name__ == '__main__':
    sys.exit(main())
