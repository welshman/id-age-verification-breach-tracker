#!/usr/bin/env python3
"""Discover identity/age-verification breach candidates from global public feeds.

Candidates are never published automatically. The workflow writes them to
pending-review.json and opens a review issue for human verification.
"""
import json, os, re, sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
import feedparser

ROOT=Path(__file__).resolve().parent.parent
DATA=ROOT/'data'
CONFIG=DATA/'update-config.json'
EXTENSION=DATA/'source-extension-ransomware-regulators.json'
BREACHES=DATA/'breaches.json'
PENDING=DATA/'pending-review.json'
LAST=DATA/'last-run.json'
UA='id-age-verification-breach-tracker/3.0 (+https://github.com/)'

def load(path, default):
    try:
        with path.open(encoding='utf-8') as f:return json.load(f)
    except Exception:return default

def save(path,data):
    with path.open('w',encoding='utf-8') as f:json.dump(data,f,indent=2,ensure_ascii=False);f.write('\n')

def fetch(url):
    req=Request(url,headers={'User-Agent':UA,'Accept':'application/json, application/rss+xml, application/atom+xml, text/xml, */*'})
    with urlopen(req,timeout=25) as r:return r.read()

def slug(value):return re.sub(r'[^a-z0-9]+','-',value.lower().strip()).strip('-')[:80]

def matches(text,keys):
    text=text.lower();return [k for k in keys if k.lower() in text]

def discover_rss(urls,keys,seen):
    result=[]
    for url in urls:
        try:parsed=feedparser.parse(fetch(url))
        except Exception as e:
            print(f'[warn] feed failed {url}: {e}',file=sys.stderr);continue
        for item in parsed.entries[:75]:
            title=getattr(item,'title','') or '';summary=getattr(item,'summary','') or '';link=getattr(item,'link','') or ''
            found=matches(title+' '+summary,keys)
            if link and link not in seen and found:
                result.append({'type':'rss_candidate','suggested_id':slug(title),'title':title.strip(),'source_url':link,'feed':url,'matched_keywords':found,'discovered_at':datetime.now(timezone.utc).isoformat()})
    return result

def discover_json_apis(sources,keys,seen):
    result=[]
    for source in sources:
        url=source.get('url','')
        if source.get('type')!='json' or not url:continue
        try:payload=json.loads(fetch(url))
        except Exception as e:
            print(f'[warn] api failed {url}: {e}',file=sys.stderr);continue
        records=payload.get('breaches',payload.get('victims',payload)) if isinstance(payload,dict) else payload
        if not isinstance(records,list):continue
        for row in records[:100]:
            title=str(row.get('title') or row.get('name') or row.get('organization') or row.get('victim') or '')
            link=str(row.get('url') or row.get('link') or '')
            summary=str(row.get('description') or row.get('summary') or row.get('group_name') or '')
            found=matches(title+' '+summary,keys)
            if title and found and (not link or link not in seen):
                result.append({'type':'api_candidate','suggested_id':slug(title),'title':title,'source_url':link,'feed':url,'matched_keywords':found,'discovered_at':datetime.now(timezone.utc).isoformat()})
    return result

def discover_hibp(config,ids):
    if not config.get('hibp_integration',{}).get('enabled') or not os.getenv('HIBP_API_KEY'):return []
    try:
        req=Request('https://haveibeenpwned.com/api/v3/breaches',headers={'User-Agent':UA,'hibp-api-key':os.getenv('HIBP_API_KEY')})
        with urlopen(req,timeout=25) as r:data=json.loads(r.read())
    except Exception as e:
        print(f'[warn] HIBP failed: {e}',file=sys.stderr);return []
    classes={'passport numbers','government issued ids',"driver's license numbers",'national identification numbers','biometric data','social security numbers'}
    out=[]
    for b in data:
        hit={x.lower() for x in b.get('DataClasses',[])}&classes;sid=slug(b.get('Name',''))
        if hit and sid not in ids:out.append({'type':'hibp_candidate','suggested_id':sid,'title':b.get('Title',b.get('Name','')),'source_url':'https://haveibeenpwned.com/PwnedWebsites#'+b.get('Name',''),'matched_data_classes':sorted(hit),'breach_date':b.get('BreachDate',''),'discovered_at':datetime.now(timezone.utc).isoformat()})
    return out

def main():
    config=load(CONFIG,{})
    extension=load(EXTENSION,{})
    breaches=load(BREACHES,{'breaches':[]}).get('breaches',[])
    pending=load(PENDING,[])
    seen={s for b in breaches for s in b.get('sources',[])}|{x.get('source_url') for x in pending if x.get('source_url')}
    keys=config.get('company_keywords',[])+config.get('breach_keywords',[])
    feeds=list(dict.fromkeys(config.get('rss_feeds',[])+config.get('cert_rss_feeds',[])+[x.get('url') for x in extension.get('real_time_sources',[]) if x.get('type')=='rss']))
    apis=config.get('api_sources',[])+[x for x in extension.get('real_time_sources',[]) if x.get('type')=='json']
    candidates=discover_rss(feeds,keys,seen)+discover_json_apis(apis,keys,seen)+discover_hibp(config,{b.get('id') for b in breaches})
    existing={x.get('source_url') for x in pending};new=[]
    for c in candidates:
        if c.get('source_url') and c['source_url'] not in existing:
            new.append(c);existing.add(c['source_url'])
    save(PENDING,pending+new)
    save(LAST,{'last_run_at':datetime.now(timezone.utc).isoformat(),'configured_rss_feeds':len(feeds),'configured_api_sources':len(apis),'candidates_found':len(candidates),'new_candidates_this_run':len(new),'total_pending_review':len(pending)+len(new),'source_policy':'Candidates require review before publication.'})
    print(f'Feeds: {len(feeds)} | APIs: {len(apis)} | New candidates: {len(new)}')
if __name__=='__main__':main()
