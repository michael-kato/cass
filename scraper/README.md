# CASS Scraper Worker

Cloudflare Worker that scrapes Practiscore registration pages for spots remaining,
stores results in KV, and exposes them via a simple API for the CASS site.

## Setup

```bash
cd scraper-worker
npm install

# 1. Create the KV namespace
npx wrangler kv namespace create MATCH_DATA
# Copy the ID it prints and paste into wrangler.toml under kv_namespaces.id

# 2. Deploy
npx wrangler deploy
```

## Adding matches to scrape

Edit the `MATCH_SLUGS` array in `wrangler.toml`:
```toml
[vars]
MATCH_SLUGS = '["your-match-slug", "another-match-slug"]'
```

The slug is the part of the Practiscore URL after `practiscore.com/`:
`https://practiscore.com/renton-idpa-2026-april/register` → slug is `renton-idpa-2026-april`

## API endpoints

**GET /data?slug=renton-idpa-2026-april**
Returns stored data for a single match.

**GET /data**
Returns all stored match data.

**GET /scrape?slug=renton-idpa-2026-april**
Manually triggers a scrape for a single match (useful for testing).

## Schedule

Runs every 3 hours via cron trigger. Adjust in `wrangler.toml`:
```toml
[triggers]
crons = ["0 */3 * * *"]   # every 3 hours
crons = ["0 * * * *"]     # every hour
crons = ["*/30 * * * *"]  # every 30 minutes
```

## Using in the CASS site

In `events.html`, fetch spots data from the worker and merge into event cards:

```javascript
fetch('https://cass-scraper.YOUR-SUBDOMAIN.workers.dev/data')
  .then(r => r.json())
  .then(matchData => {
    // matchData['renton-idpa-2026-april'].spotsText → "15 spots remaining"
    // merge into your EVENTS array before rendering
  });
```

## Response shape

```json
{
  "slug": "renton-idpa-2026-april",
  "url": "https://practiscore.com/renton-idpa-2026-april/register",
  "spotsText": "15 of 60 registered",
  "allAlerts": ["15 of 60 registered", "Registration closes April 10"],
  "scrapedAt": "2026-04-04T20:00:00.000Z",
  "success": true
}
```

## Failure behavior

If a scrape fails (blocked, timeout, etc.), the worker stores the error with a 1 hour TTL
so the site knows the last attempt failed. The site should fall back to showing a
"Registration info unavailable" message rather than stale data.
