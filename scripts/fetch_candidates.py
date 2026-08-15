#!/usr/bin/env python3
"""
scripts/fetch_candidates.py — Automated discovery step for the ID/Age
Verification Breach Tracker.

This script does NOT modify breaches.json or companies.json directly.
Instead, it:
  1. Loads keyword configuration from data/update-config.json.
  2. Polls configured public RSS feeds for recent articles matching
     identity/age-verification breach keywords or known company names.
  3. Optionally queries the Have I Been Pwned API (if HIBP_API_KEY is set)
     for recently added breaches, filtered by identity-document data classes.
  4. Writes new, not-already-tracked matches to data/pending-review.json
     and updates data/last-run.json with run metadata.

Human review (via the GitHub Issue opened by the workflow) is required
before anything here is merged into the public-facing JSON data files,
to avoid auto-publishing unverified claims about real companies.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

import feedparser

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CONFIG_PATH = DATA_DIR / "update-config.json"
BREACHES_PATH = DATA_DIR / "breaches.json"
PENDING_PATH = DATA_DIR / "pending-review.json"
LAST_RUN_PATH = DATA_DIR / "last-run.json"

USER_AGENT = "id-age-verification-breach-tracker/1.0 (+https://github.com/)"


def load_json(path, default):
    if not path.exists():
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def slugify(text):
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")[:80]


def existing_ids(breaches):
    return {b["id"] for b in breaches}


def existing_source_urls(breaches):
    urls = set()
    for b in breaches:
        for s in b.get("sources", []):
            urls.add(s)
    return urls


def fetch_rss_candidates(config, known_source_urls):
    candidates = []
    breach_kw = [k.lower() for k in config.get("breach_keywords", [])]
    company_kw = [k.lower() for k in config.get("company_keywords", [])]
    all_kw = breach_kw + company_kw

    for feed_url in config.get("rss_feeds", []):
        try:
            req = Request(feed_url, headers={"User-Agent": USER_AGENT})
            with urlopen(req, timeout=20) as resp:
                raw = resp.read()
            parsed = feedparser.parse(raw)
        except (URLError, HTTPError, TimeoutError) as e:
            print(f"[warn] could not fetch feed {feed_url}: {e}", file=sys.stderr)
            continue
        except Exception as e:
            print(f"[warn] unexpected error parsing feed {feed_url}: {e}", file=sys.stderr)
            continue

        for entry in parsed.entries[:40]:
            title = getattr(entry, "title", "") or ""
            summary = getattr(entry, "summary", "") or ""
            link = getattr(entry, "link", "") or ""
            haystack = f"{title} {summary}".lower()

            if not link or link in known_source_urls:
                continue

            matched_kw = [kw for kw in all_kw if kw in haystack]
            if not matched_kw:
                continue

            candidates.append({
                "type": "breach_candidate",
                "suggested_id": slugify(title) or f"candidate-{len(candidates)}",
                "title": title.strip(),
                "source_url": link,
                "matched_keywords": matched_kw,
                "feed": feed_url,
                "discovered_at": datetime.now(timezone.utc).isoformat(),
            })

    return candidates


def fetch_hibp_candidates(config, known_ids):
    hibp_cfg = config.get("hibp_integration", {})
    if not hibp_cfg.get("enabled"):
        return []

    api_key = os.environ.get("HIBP_API_KEY")
    if not api_key:
        print("[info] HIBP_API_KEY not set; skipping HIBP integration.")
        return []

    id_related_classes = {
        "passport numbers", "government issued ids", "driver's license numbers",
        "national identification numbers", "social security numbers", "biometric data",
    }

    try:
        req = Request(
            "https://haveibeenpwned.com/api/v3/breaches",
            headers={"User-Agent": USER_AGENT, "hibp-api-key": api_key},
        )
        with urlopen(req, timeout=20) as resp:
            all_breaches = json.loads(resp.read())
    except (URLError, HTTPError, TimeoutError) as e:
        print(f"[warn] HIBP API request failed: {e}", file=sys.stderr)
        return []
    except Exception as e:
        print(f"[warn] unexpected error querying HIBP: {e}", file=sys.stderr)
        return []

    candidates = []
    for b in all_breaches:
        data_classes = {dc.lower() for dc in b.get("DataClasses", [])}
        if not (data_classes & id_related_classes):
            continue
        slug = slugify(b.get("Name", ""))
        if slug in known_ids:
            continue
        candidates.append({
            "type": "breach_candidate_hibp",
            "suggested_id": slug,
            "title": b.get("Title", b.get("Name", "")),
            "source_url": f"https://haveibeenpwned.com/PwnedWebsites#{b.get('Name','')}",
            "matched_data_classes": sorted(data_classes & id_related_classes),
            "breach_date": b.get("BreachDate", ""),
            "discovered_at": datetime.now(timezone.utc).isoformat(),
        })
    return candidates


def main():
    config = load_json(CONFIG_PATH, {})
    breaches_data = load_json(BREACHES_PATH, {"breaches": []})
    breaches = breaches_data.get("breaches", [])

    known_ids = existing_ids(breaches)
    known_source_urls = existing_source_urls(breaches)

    rss_candidates = fetch_rss_candidates(config, known_source_urls)
    hibp_candidates = fetch_hibp_candidates(config, known_ids)

    all_candidates = rss_candidates + hibp_candidates

    existing_pending = load_json(PENDING_PATH, [])
    existing_pending_urls = {c.get("source_url") for c in existing_pending}
    new_candidates = [c for c in all_candidates if c.get("source_url") not in existing_pending_urls]

    combined_pending = existing_pending + new_candidates
    save_json(PENDING_PATH, combined_pending)

    save_json(LAST_RUN_PATH, {
        "last_run_at": datetime.now(timezone.utc).isoformat(),
        "rss_candidates_found": len(rss_candidates),
        "hibp_candidates_found": len(hibp_candidates),
        "new_candidates_this_run": len(new_candidates),
        "total_pending_review": len(combined_pending),
    })

    print(f"RSS candidates found: {len(rss_candidates)}")
    print(f"HIBP candidates found: {len(hibp_candidates)}")
    print(f"New candidates this run: {len(new_candidates)}")


if __name__ == "__main__":
    main()
