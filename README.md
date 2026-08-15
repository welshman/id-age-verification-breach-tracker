# Global ID & Age Verification Breach Tracker

A free, independent, fully static website that tracks **publicly reported data breaches**
involving identity documents (passports, national ID cards, driver's licences) and the
identity-verification / KYC / age-verification services that process them.

Conceptually inspired by [Have I Been Pwned](https://haveibeenpwned.com/), but focused
specifically on identity and age-verification breaches rather than email/password leaks.

**Live demo:** enable GitHub Pages on this repo (see Deployment below) and
your site will be available at `https://<your-username>.github.io/<repo-name>/`.

## Features

- **Homepage** with live stats (total breaches, total companies, most recent breach) and a timeline.
- **Breaches directory** — searchable, filterable (region, severity, company, data type, sort order)
  list of every tracked breach, each with full details and linked sources.
- **Companies directory** — searchable, filterable directory of identity-verification, KYC, and
  age-verification companies worldwide, each showing linked known breaches (or "no known breaches").
- **FAQ / methodology / ethics page** explaining exactly how data is collected, what the site is
  and isn't, privacy guarantees, and limitations.
- **Automated data pipeline** via GitHub Actions that discovers new candidate breaches/companies
  from public RSS feeds and (optionally) the HIBP API, without auto-publishing unverified claims.

## Repository structure

```
/
├── index.html              Homepage
├── breaches.html            List of all ID/age-verification breaches
├── companies.html           List of all monitored companies
├── faq.html                 FAQ / how it works / ethics
├── styles.css                Shared stylesheet
├── main.js                   Client-side logic (fetches JSON, renders UI, filters and search)
├── data/
│   ├── breaches.json          Structured breach data (hand-curated, research-backed)
│   ├── companies.json         Structured company/service data
│   ├── sources.json           Data sources used & methodology notes
│   ├── update-config.json     Keyword/feed configuration for the automation pipeline
│   ├── pending-review.json    Auto-discovered candidates awaiting human confirmation
│   └── last-run.json          Metadata about the most recent automated pipeline run
├── scripts/
│   └── fetch_candidates.py    Helper script run by the GitHub Actions workflow
├── .github/workflows/
│   └── update-data.yml        Scheduled workflow that runs the discovery pipeline
└── README.md
```

## Data model

### `data/companies.json`

```json
{
  "id": "yoti",
  "name": "Yoti",
  "website": "https://www.yoti.com",
  "region": "UK",
  "type": "id_verification",
  "description": "Short description of what they do.",
  "known_breaches": ["breach-id-1"],
  "notes": "Any relevant notes."
}
```

`type` is one of: `id_verification`, `age_verification`, `kyc`, `mixed`.
`region` is a free-text region code (`global`, `EU`, `US`, `UK`, `APAC`, `LATAM`, etc.).

### `data/breaches.json`

```json
{
  "id": "example-2025-breach",
  "title": "Human-readable name",
  "date": "2025-01-01",
  "companies": ["company-id"],
  "data_types": ["passport", "national_id", "drivers_license", "selfie", "address", "dob"],
  "severity": "high",
  "summary": "Short, clear description.",
  "details": "Longer description of what happened.",
  "sources": ["https://example.com/article"],
  "affected_regions": ["global"],
  "verification_type": "kyc"
}
```

`severity` is one of `low`, `medium`, `high`, `critical` — an editorial judgment based on scale
and sensitivity of exposed data, not an official standard.

### `data/sources.json`

Lists the categories of sources used (news outlets, security researchers, company disclosures,
the HIBP API) along with methodology notes.

## How the automation works

1. **`update-data.yml`** runs weekly (Mondays at 06:00 UTC) and can also be triggered manually
   from the Actions tab (`workflow_dispatch`).
2. It runs **`scripts/fetch_candidates.py`**, which:
   - Reads keyword and feed configuration from `data/update-config.json`.
   - Polls the RSS feeds listed there for articles matching identity/age-verification keywords.
   - If a `HIBP_API_KEY` repository secret is configured, also queries the HIBP API for breaches
     whose `DataClasses` include identity-document-related fields (passport numbers, government
     IDs, driver's license numbers, etc.).
   - Skips anything whose source URL is already cited in `breaches.json` or already pending.
   - Writes new candidates to `data/pending-review.json` and updates `data/last-run.json`.
3. The workflow commits and pushes these files back to the repo (so GitHub Pages picks up the
   updated `last-run.json` immediately) and opens/updates a GitHub Issue labeled
   `automated-review` summarizing new candidates found.
4. **A maintainer reviews the issue**, checks each candidate's source, and — if confirmed — adds
   a properly-formatted entry to `breaches.json` and/or `companies.json` via a normal commit or
   pull request, then removes the item from `pending-review.json`.

This two-step design (automated discovery + lightweight human confirmation) is deliberate: fully
automated, zero-review publication of breach claims about real companies risks propagating
false positives from keyword matching as fact. See `faq.html` for the full rationale.

### Adding new data sources or keywords

Do **not** hand-edit `breaches.json` to add speculative entries. Instead:

- To track a new company by name, add it to `company_keywords` in `data/update-config.json`.
- To catch a new phrasing of breach reports, add it to `breach_keywords`.
- To add a new RSS feed to monitor, add its URL to `rss_feeds`.
- To enable the HIBP API integration, add a repository secret named `HIBP_API_KEY`
  (Settings → Secrets and variables → Actions → New repository secret). Never commit API keys
  to the repository itself.

## Deployment

1. This repository already contains all files pushed to the `main` branch.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to `Deploy from a branch`.
4. Choose branch `main` and folder `/ (root)`, then **Save**.
5. Wait 1–2 minutes; your site will be live at
   `https://<your-username>.github.io/<repo-name>/`.
6. (Optional) Add a `HIBP_API_KEY` repository secret if you want the automation to also query
   the Have I Been Pwned API. The site works fully without it, relying on RSS-based discovery.
7. No further manual steps are required. The scheduled workflow will begin discovering new
   candidate breaches on the next Monday run, or you can trigger it immediately from the
   **Actions** tab via **Run workflow**.

## Privacy & ethics

This site never asks users for actual passport numbers, ID numbers, or other sensitive
identifiers, has no backend server, and no database. It only reads pre-generated public JSON
data files and renders them client-side. See `faq.html` for the full ethics and methodology
statement, including known limitations of the dataset.

## License

Code in this repository may be reused freely for non-commercial awareness purposes. Breach data
is sourced from public reporting; always refer to the linked original sources for authoritative
details.
