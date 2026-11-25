# Snip API and public website

This repository contains Snip's serverless search endpoints and public website.

## API configuration

Set `OPENAI_API_KEY` in the hosting provider's secret/environment-variable settings for AI-assisted searches. Do not commit the key or put it in client-side extension code.

`api/find.js` searches supplied webpage/document text. `api/pdf-find.js` fetches a public PDF URL, extracts readable text, and returns source evidence with its PDF page number. The extractor attempts to preserve visual reading order and separate multi-column text, but PDF layouts vary and extraction quality depends on the source file. For scanned/image-only PDFs, OCR is optional and disabled by default. To enable it, set `SNIP_OCR_SPACE_API_KEY` in the hosting provider's environment settings. When enabled, PDFs with one or more pages that have no extractable text are sent to OCR.space at `https://api.ocr.space/parse/image`; this sends document contents to that third-party service, so enable it only if that processing is acceptable for your users and documents. Without the key, scanned PDFs receive a clear unsupported/configuration message. OCR service limits and recognition errors can still affect results.


## PDF fetch security

The PDF endpoint rejects non-public IP literals and special-use IPv4/IPv6 destinations, refuses credential-bearing URLs, validates each redirect, and pins outbound connections to DNS answers that have been checked as public. If any DNS answer is private or otherwise disallowed, the request is rejected rather than choosing only the public answer. Automated tests cover loopback/private addresses, special-use IPv6 ranges, mixed public/private DNS answers, redirect validation, and a permitted global IPv6 address.

These checks reduce server-side request forgery risk; they are not a substitute for reviewing hosting-network egress controls and monitoring before production rollout.

## Tests

Install dependencies and run the automated suite:

```sh
npm install
npm test
```

The PDF integration suite includes security regressions for private and special-use IPs, DNS rebinding/mixed DNS answers, redirect validation, OCR page-slot handling, and the FY2026 M&S liquidity disclosure. The FY2026 primary-statement cash integration test is opt-in because the source PDF is not committed.

To run that test, supply the exact FY2026 PDF and values independently verified against that report edition:

```sh
SNIP_MS_PDF_PATH=/path/to/verified-fy2026-report.pdf \
SNIP_MS_EXPECTED_ANSWER='<verified cash amount>' \
SNIP_MS_EXPECTED_PERIOD='<verified reporting date>' \
SNIP_MS_EXPECTED_QUOTE='<exact primary-statement quote>' \
SNIP_MS_EXPECTED_PAGE=<physical-pdf-page-number> \
SNIP_MS_EXPECTED_PAGE_COUNT=<pdf-page-count> \
npm test
```

The liquidity regression checks the disclosure on printed page 24 / PDF page 26 and preserves the report's stated total separately from its rounded components. Do not copy values or page numbers from another report edition.
