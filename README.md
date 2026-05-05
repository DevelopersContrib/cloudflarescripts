# handymanroot2026 — Handyman CF Worker Templates

Two Cloudflare Worker landing pages for the Handyman Partner Network.
Managed/deployed via **manage.vnoc.com/v2/cfbuilder**.

## Workers

| Worker | File | Purpose |
|--------|------|---------|
| `handyman-contractors` | `src/contractors-worker.js` | Contractor spotlight lander — drives signups via featured paid pros |
| `handyman-community` | `src/community-worker.js` | Projects + Forum lander — showcases live activity to attract users |

## Multi-Domain

Both workers serve **any domain** pointing to them. The domain is auto-detected
from `request.headers.host` and:
1. Auto-registered in handyman.com's `domain_affiliates` table (partner program)
2. Used to fetch branding/logo from VNOC API
3. Injected into all CTA/referral links as `?ref={affiliate_id}`

## Adding to cfbuilder

1. Go to **manage.vnoc.com/v2/cfbuilder → Templates → New Template**
2. Name: `handyman-contractors` | Paste contents of `src/contractors-worker.js`
3. Name: `handyman-community` | Paste contents of `src/community-worker.js`
4. Deploy via cfbuilder selecting the Handyman vertical

## Template Variables (injected by buildLanderScript)

| Variable | Example |
|----------|---------|
| `{{DOMAIN}}` | `apluscontractors.com` |
| `{{PAGE_TITLE}}` | `A Plus Contractors` |
| `{{META_DESCRIPTION}}` | Auto-generated |
| `{{VERTICAL_COLOR}}` | `#670708` |
| `{{LOGO_HTML}}` | `<img src="..."/>` or `""` |
| `{{SIBLINGS_JSON}}` | `["relatedomain.com"]` |
| `{{HANDYMAN_API_URL}}` | `https://www.handyman.com` |
| `{{WORKER_API_KEY}}` | `WORKER_API_KEY` env var |
| `{{HANDYMAN_SIGNUP_URL}}` | `https://www.handyman.com/signup` |
| `{{HANDYMAN_REFER_URL}}` | `https://www.handyman.com/refer` |

## KV Setup (for local dev / direct wrangler deploy)

```bash
cd handymanroot2026
npm install
# Create KV namespace
wrangler kv:namespace create "handyman-cache" --config wrangler.contractors.toml
# Update both wrangler.*.toml files with the returned KV id
# Set secret
wrangler secret put WORKER_API_KEY --config wrangler.contractors.toml
```

## Handyman.com API endpoints (handyman2026 Next.js)

| Endpoint | Auth | Returns |
|----------|------|---------|
| `GET /api/public/contractors?limit=6` | None | Paid contractor spotlight |
| `GET /api/public/projects?limit=6` | None | Latest open projects |
| `GET /api/public/questions?limit=8` | None | Latest Q&A threads |
| `POST /api/affiliate/register-domain` | WORKER_API_KEY | Auto-register domain affiliate |
| `POST /api/affiliate/apply` | None (public) | External partner self-enrollment |

## Partner Program page
`https://www.handyman.com/partners` — public page where external site owners apply to become referral partners.

## DB migrations needed (handyman2026)

```bash
cd handyman.com/handyman-new/handyman2026
pnpm db:migrate:dev
```

Adds tables: `domain_affiliates`, `affiliate_commissions`

## Add Handyman vertical to cfbuilder DB

```sql
INSERT INTO cloudflare_verticals (vertical_name, keywords, template_id)
VALUES ('Handyman', 'handyman,contractor,repair,plumber,electrician,roofer,handymen,serviceprovider,tradesman', NULL)
ON DUPLICATE KEY UPDATE keywords=VALUES(keywords);
```
