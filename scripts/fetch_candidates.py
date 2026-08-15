#!/usr/bin/env python3
"""Discover identity/age-verification breach candidates from global public feeds.

Candidates are never published automatically. The workflow writes them to
pending-review.json and opens a review issue for human verification.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import feedparser

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CONFIG_PATH = DATA / "update-config.json"
BREACHES_PATH = DATA / "breaches.json"
PENDING_PATH = DATA / "pending-review.json"
LAST_RUN_PATH = DATA / "last-run.json"
USER_AGENT = "id-age-verification-breach-tracker/2.0 (+https://github.com/)"


def load_json(path, default):
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_json(path, payload):
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def slugify(value):
    value = re.sub(r"[^a-z0-9]+", "-", value.lower().strip())
    return value.strip("-")[:80]


def fetch_bytes(url):
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json, application/rss+xml, application/atom+xml, text/xml, */*"})
    with urlopen(request, timeout=25) as response:
        return response.read()


def known_sources(breaches):
    return {source for breach in breaches for source in breach.get("sources", [])}


def matches_keywords(text, keywords):
    lower = text.lower()
    return [keyword for keyword in keywords if keyword.lower() in lower]


def rss_candidates(urls, keywords, seen_urls):
    candidates = []
    for url in urls:
        try:
            parsed = feedparser.parse(fetch_bytes(url))
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            print(f"[warn] RSS fetch failed {url}: {exc}", file=sys.stderr)
            continue
        except Exception as exc:
            print(f"[warn] RSS parse failed {url}: {exc}", file=sys.stderr)
            continue
        for entry in parsed.entries[:75]:
            title = getattr(entry, "title", "") or ""
            summary = getattr(entry, "summary", "") or ""
            link = getattr(entry, "link", "") or ""
            if not link or link in seen_urls:
                continue
            keywords_found = matches_keywords(f"{title} {summary}", keywords)
            if not keywords_found:
                continue
            candidates.append({"type":"rss_candidate","suggested_id":slugify(title),"title":title.strip(),"source_url":link,"feed":url,"matched_keywords":keywords_found,"discovered_at":datetime.now(timezone.utc).isoformat()})
    return candidates


def recent_breaches_candidates(config, keywords, seen_urls):
    result = []
    for source in config.get("api_sources", []):
        if source.get("name") != "RecentBreaches API":
            continue
        try:
            payload = json.loads(fetch_bytes(source["url"]))
        except Exception as exc:
            print(f"[warn] RecentBreaches API failed: {exc}", file=sys.stderr)
            continue
        records = payload.get("breaches", payload) if isinstance(payload, dict) else payload
        if not isinstance(records, list):
            continue
        for record in records[:100]:
            title = str(record.get("title") or record.get("name") or record.get("organization") or "")
            link = str(record.get("url") or record.get("link") or "")
            description = str(record.get("description") or record.get("summary") or "")
            if not title or (link and link in seen_urls):
                continue
            found = matches_keywords(f"{title} {description}", keywords)
            if found:
                result.append({"type":"api_candidate","suggested_id":slugify(title),"title":title,"source_url":link,"feed":source["url"],"matched_keywords":found,"discovered_at":datetime.now(timezone.utc).isoformat()})
    return result


def hibp_candidates(config, existing_ids):
    if not config.get("hibp_integration", {}).get("enabled"):
        return []
    key = os.environ.get("HIBP_API_KEY")
    if not key:
        print("[info] HIBP_API_KEY not set; skipping HIBP.")
        return []
    try:
        req = Request("https://haveibeenpwned.com/api/v3/breaches", headers={"User-Agent": USER_AGENT, "hibp-api-key": key})
        with urlopen(req, timeout=25) as response:
            payload = json.loads(response.read())
    except Exception as exc:
        print(f"[warn] HIBP query failed: {exc}", file=sys.stderr)
        return []
    identity_classes = {"passport numbers", "government issued ids", "driver's license numbers", "national identification numbers", "biometric data", "social security numbers"}
    result = []
    for breach in payload:
        classes = {item.lower() for item in breach.get("DataClasses", [])}
        suggested = slugify(breach.get("Name", ""))
        if not (classes & identity_classes) or suggested in existing_ids:
            continue
        result.append({"type":"hibp_candidate","suggested_id":suggested,"title":breach.get("Title", breach.get("Name", "")),"source_url":f"https://haveibeenpwned.com/PwnedWebsites#{breach.get('Name', '')}","matched_data_classes":sorted(classes & identity_classes),"breach_date":breach.get("BreachDate", ""),"discovered_at":datetime.now(timezone.utc).isoformat()})
    return result


def main():
    config = load_json(CONFIG_PATH, {})
    breach_data = load_json(BREACHES_PATH, {"breaches": []})
    breaches = breach_data.get("breaches", [])
    existing_ids = {item.get("id") for item in breaches}
    seen_urls = known_sources(breaches)
    pending = load_json(PENDING_PATH, [])
    seen_urls |= {item.get("source_url") for item in pending if item.get("source_url")}
    keywords = config.get("company_keywords", []) + config.get("breach_keywords", [])
    feeds = list(dict.fromkeys(config.get("rss_feeds", []) + config.get("cert_rss_feeds", [])))
    candidates = rss_candidates(feeds, keywords, seen_urls)
    candidates += recent_breaches_candidates(config, keywords, seen_urls)
    candidates += hibp_candidates(config, existing_ids)
    unique, already = [], {item.get("source_url") for item in pending}
    for item in candidates:
        url = item.get("source_url")
        if url and url not in already:
            unique.append(item)
            already.add(url)
    all_pending = pending + unique
    save_json(PENDING_PATH, all_pending)
    save_json(LAST_RUN_PATH, {"last_run_at":datetime.now(timezone.utc).isoformat(),"configured_rss_feeds":len(feeds),"rss_and_api_candidates_found":len(candidates),"new_candidates_this_run":len(unique),"total_pending_review":len(all_pending),"source_policy":"Candidates require review before publication."})
    print(f"Configured feeds: {len(feeds)}")
    print(f"Candidates found: {len(candidates)}")
    print(f"New candidates: {len(unique)}")


if __name__ == "__main__":
    main()
