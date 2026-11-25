# Snip API and public website

This repository contains Snip's serverless search endpoints and public website.

## API configuration

Set `OPENAI_API_KEY` in the hosting provider's secret/environment-variable settings for AI-assisted searches. Do not commit the key or put it in client-side extension code.

`api/find.js` searches supplied webpage/document text. `api/pdf-find.js` fetches a public PDF URL, extracts readable text, and returns source evidence with its PDF page number. The extractor attempts to preserve visual reading order and separate multi-column text, but PDF layouts vary and extraction quality depends on the source file. For scanned/image-only PDFs, OCR is optional and disabled by default. To enable it, set `SNIP_OCR_SPACE_API_KEY` in the hosting provider's environment settings. When enabled, PDFs with one or more pages that have no extractable text are sent to OCR.space at `https://api.ocr.space/parse/image`; this sends document contents to that third-party service, so enable it only if that processing is acceptable for your users and documents. Without the key, scanned PDFs receive a clear unsupported/configuration message. OCR service limits and recognition errors can still affect results.


## PDF fetch security

The PDF endpoint rejects non-public IP literals and special-use IPv4/IPv6 destinations, refuses credential-bearing URLs, validates each redirect, and pins outbound connections to DNS answers that have been checked as public. If any DNS answer is private or otherwise disallowed, the request is rejected rather than choosing only the public answer. Automated tests cover loopback/private addresses, special-use IPv6 ranges, mixed public/private DNS answers, redirect validation, and a permitted global IPv6 address.

These checks reduce server-side request forgery risk; they are not a substitute for reviewing hosting-network egress controls and monitoring before production rollout.

## Usage reservation safety

Search reservations are claimed atomically by changing their status from `reserved` to `processing` with a conditional Supabase REST update. Only one concurrent backend request can claim a reservation. The extension commits the claim after successful evidence verification/highlighting, or releases it when the operation fails. The database commit/release functions accept both `reserved` (for older in-flight clients) and `processing`.

**Apply `supabase/migrations/202611250001_atomic_usage_claims.sql` to the Supabase database before deploying the API code that performs atomic claims.** The migration adds the `processing` status and updates authenticated and anonymous reservation accounting, expiry, commit, and release functions. Do not deploy the API change without this migration.

## Tests

Install dependencies and run the automated suite:

```sh
npm ci
npm test
```

GitHub Actions downloads the official [M&S FY2026 Annual Report](https://corporate.marksandspencer.com/sites/marksandspencer/files/marksandspencer/annual-report/m-and-s-annual-report-and-financial-statements-2026.pdf) into the runner's temporary directory and runs both real-PDF regressions. The PDF is not committed to this repository. The cash test verifies £997.2m for 28 March 2026 on physical PDF page 116; the liquidity test verifies the £1,872.1m disclosure on printed page 24 / PDF page 26, preserving the stated total separately from its rounded components.

For a local run, supply the official PDF and these independently verified cash expectations:

```sh
SNIP_MS_PDF_PATH=/path/to/m-and-s-annual-report-and-financial-statements-2026.pdf \
SNIP_MS_EXPECTED_ANSWER='£997.2m' \
SNIP_MS_EXPECTED_PERIOD='28 March 2026' \
SNIP_MS_EXPECTED_PAGE=116 \
npm test
```

Do not copy values or page numbers from another report edition.
