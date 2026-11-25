import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFinancialSection,
  extractFinancialRows,
  extractFinancialRowsFromItems,
  extractPageLines,
  selectLiquidityEvidence,
  selectPrimaryFinancialEvidence
} from "../api/pdf-search-utils.js";

test("extractPageLines preserves visual row and column order", () => {
  const lines = extractPageLines([
    { str: "1,022.4", transform: [1, 0, 0, 1, 320, 100] },
    { str: "Cash and cash equivalents", transform: [1, 0, 0, 1, 40, 100] },
    { str: "Prior period", transform: [1, 0, 0, 1, 40, 80] }
  ]);

  assert.deepEqual(lines, [
    "Cash and cash equivalents 1,022.4",
    "Prior period"
  ]);
});

test("classifies consolidated primary statements separately from reconciliations", () => {
  assert.equal(
    classifyFinancialSection("CONSOLIDATED STATEMENT OF FINANCIAL POSITION\nCash and cash equivalents 18 864.5 1,022.4"),
    "Primary consolidated statement of financial position"
  );
  assert.equal(
    classifyFinancialSection("B. Reconciliation of net debt to statement of financial position\nCash and cash equivalents 863.7 995.4"),
    "Reconciliation"
  );
});

test("M&S-style FY2025 cash query selects the primary consolidated statement and requested period", () => {
  const pages = [
    {
      page: 32,
      text: [
        "FINANCIAL REVIEW CONTINUED",
        "The composition of Group net debt is as follows:",
        "Cash and cash equivalents 1 863.7 995.4 (157.9)"
      ].join("\n")
    },
    {
      page: 126,
      text: [
        "CONSOLIDATED STATEMENT OF FINANCIAL POSITION",
        "As at As at As at As at",
        "29 March 30 March 29 March 30 March",
        "2025 2024 2025 2024",
        "Notes £m £m Notes £m £m",
        "Cash and cash equivalents 17 863.7 995.4 — —"
      ].join("\n")
    },
    {
      page: 181,
      text: [
        "B. Reconciliation of net debt to statement of financial position",
        "2025 2024 £m £m",
        "Cash and cash equivalents (see note 17) 863.7 995.4"
      ].join("\n")
    }
  ];
  const rows = pages.flatMap(({ page, text }, index) =>
    extractFinancialRows(text, page, index * 10)
  );

  const result = selectPrimaryFinancialEvidence(
    "What were cash and cash equivalents for FY2025?",
    rows
  );

  assert.ok(result);
  assert.equal(result.answer, "£863.7m");
  assert.equal(result.period, "29 March 2025");
  assert.equal(result.row.page, 126);
  assert.equal(result.row.section, "Primary consolidated statement of financial position");
  assert.equal(result.sourceQuote, "Cash and cash equivalents 17 863.7 995.4 — —");
});

test("period selection uses the requested comparative year", () => {
  const rows = extractFinancialRows([
    "CONSOLIDATED STATEMENT OF FINANCIAL POSITION",
    "As at As at",
    "29 March 30 March",
    "2025 2024",
    "Notes £m £m",
    "Cash and cash equivalents 17 863.7 995.4"
  ].join("\n"), 126);

  const result = selectPrimaryFinancialEvidence(
    "What were cash and cash equivalents in FY2024?",
    rows
  );

  assert.equal(result?.answer, "£995.4m");
  assert.equal(result?.period, "30 March 2024");
});

test("does not use a reconciliation when no primary statement row exists", () => {
  const rows = extractFinancialRows([
    "B. Reconciliation of net debt to statement of financial position",
    "2025 2024 £m £m",
    "Cash and cash equivalents 863.7 995.4"
  ].join("\n"), 181);

  assert.equal(
    selectPrimaryFinancialEvidence("Cash and cash equivalents FY2025", rows),
    null
  );
});

test("does not short-circuit explanatory or movement questions to a statement row", () => {
  const rows = extractFinancialRows([
    "CONSOLIDATED STATEMENT OF FINANCIAL POSITION",
    "As at As at",
    "29 March 30 March",
    "2025 2024",
    "Notes £m £m",
    "Cash and cash equivalents 18 864.5 1,022.4"
  ].join("\n"), 126);

  assert.equal(
    selectPrimaryFinancialEvidence("Why did cash and cash equivalents change?", rows),
    null
  );
});

test("keeps two-column prose separate while preserving financial rows", () => {
  const lines = extractPageLines([
    { str: "The first column contains a complete sentence", width: 190, transform: [1, 0, 0, 1, 40, 100] },
    { str: "The second column contains another sentence", width: 200, transform: [1, 0, 0, 1, 330, 100] },
    { str: "Cash and cash equivalents", width: 145, transform: [1, 0, 0, 1, 40, 80] },
    { str: "864.5", width: 25, transform: [1, 0, 0, 1, 320, 80] }
  ]);
  assert.deepEqual(lines, [
    "The first column contains a complete sentence",
    "The second column contains another sentence",
    "Cash and cash equivalents 864.5"
  ]);
});


test("fails closed when the requested financial year is absent", () => {
  const rows = extractFinancialRows([
    "CONSOLIDATED STATEMENT OF FINANCIAL POSITION",
    "As at As at",
    "29 March 30 March",
    "2025 2024",
    "Notes £m £m",
    "Cash and cash equivalents 18 864.5 1,022.4"
  ].join("\n"), 126);

  assert.equal(
    selectPrimaryFinancialEvidence("What were cash and cash equivalents for FY2026?", rows),
    null
  );
});

test("does not return a plausible cash row when the requested primary statement is absent", () => {
  const rows = extractFinancialRows([
    "FINANCIAL REVIEW",
    "Cash and cash equivalents 18 864.5 1,022.4"
  ].join("\n"), 32);

  assert.equal(rows.length, 0);
  assert.equal(
    selectPrimaryFinancialEvidence("What were cash and cash equivalents for FY2025?", rows),
    null
  );
});


test("fails closed when extracted financial row has fewer values than reported periods", () => {
  const row = [
    "CONSOLIDATED STATEMENT OF FINANCIAL POSITION",
    "As at As at As at As at",
    "29 March 30 March 29 March 30 March",
    "2025 2024 2025 2024",
    "Notes £m £m Notes £m £m",
    "Cash and cash equivalents 18 864.5 1,022.4"
  ].join("\n");
  const rows = extractFinancialRows(row, 126);
  assert.equal(
    selectPrimaryFinancialEvidence("What were cash and cash equivalents for FY2025?", rows),
    null
  );
});


test("separates short text fragments in two-column layouts", () => {
  const lines = extractPageLines([
    { str: "Eligibility rules", width: 100, transform: [1, 0, 0, 1, 40, 100] },
    { str: "Payment due dates", width: 100, transform: [1, 0, 0, 1, 260, 100] },
    { str: "Applicants must be over 18", width: 140, transform: [1, 0, 0, 1, 40, 80] },
    { str: "Paid every Friday", width: 100, transform: [1, 0, 0, 1, 260, 80] }
  ]);

  assert.deepEqual(lines, [
    "Eligibility rules",
    "Payment due dates",
    "Applicants must be over 18",
    "Paid every Friday"
  ]);
});

test("does not split a label and its numeric value into separate columns", () => {
  const lines = extractPageLines([
    { str: "Total due", width: 70, transform: [1, 0, 0, 1, 40, 100] },
    { str: "$1,250.00", width: 65, transform: [1, 0, 0, 1, 250, 100] }
  ]);

  assert.deepEqual(lines, ["Total due $1,250.00"]);
});


test("maps interleaved M&S 2026 statement headers to the correct cash values", () => {
  const items = [];
  const add = (str, x, y, width = str.length * 5) =>
    items.push({ str, width, transform: [1, 0, 0, 1, x, y] });

  add("CONSOLIDATED STATEMENT OF FINANCIAL POSITION", 54, 600);
  add("29 March", 328.6, 494.3);
  add("30 March", 379.4, 494.3);
  add("28 March", 276.7, 486.3);
  add("2025", 342.4, 486.3);
  add("2024", 393.3, 486.3);
  add("2026", 290.9, 478.3);
  add("Cash and cash equivalents", 53.9, 211, 190);
  add("18", 250, 211);
  add("997.2", 284.3, 211);
  add("864.5", 334.9, 211);
  add("1,022.4", 380.8, 211);

  const rows = extractFinancialRowsFromItems(items, 116);
  for (const [year, answer, period] of [
    ["2026", "997.2", "28 March 2026"],
    ["2025", "864.5", "29 March 2025"],
    ["2024", "1,022.4", "30 March 2024"]
  ]) {
    const result = selectPrimaryFinancialEvidence(
      `What were cash and cash equivalents in ${year}?`, rows
    );
    assert.ok(result, `Expected a result for ${year}`);
    assert.equal(result.answer, answer);
    assert.equal(result.period, period);
    assert.equal(result.row.page, 116);
  }
  assert.equal(
    selectPrimaryFinancialEvidence(
      "What were cash and cash equivalents in 2023?", rows
    ),
    null
  );
});

test("extracts M&S Group net debt for FY2026 and FY2025 without using the Change column", () => {
  const rows = extractFinancialRows([
    "FINANCIAL REVIEW",
    "Net debt",
    "Group net debt increased £632.0m since last year primarily driven by the increase in lease liabilities.",
    "52 weeks ended",
    "28 Mar 26",
    "£m",
    "29 Mar 25",
    "£m",
    "Change vs",
    "2024/25",
    "£m",
    "Group net debt(2,411.8)(1,779.8)(632.0)"
  ].join("\n"), 117);

  assert.equal(rows.length, 1);

  const current = selectPrimaryFinancialEvidence(
    "What was Group net debt in FY2026?", rows
  );
  assert.equal(current?.answer, "£2,411.8m");
  assert.equal(current?.period, "28 March 2026");
  assert.equal(current?.row.page, 117);
  assert.equal(current?.sourceQuote, "Group net debt(2,411.8)(1,779.8)(632.0)");

  const comparative = selectPrimaryFinancialEvidence(
    "What was Group net debt in FY2025?", rows
  );
  assert.equal(comparative?.answer, "£1,779.8m");
  assert.equal(comparative?.period, "29 March 2025");

  assert.equal(
    selectPrimaryFinancialEvidence("What was Group net debt in FY2024?", rows),
    null
  );
});

test("does not shortcut explanatory Group net debt questions to a financial row", () => {
  const rows = extractFinancialRows([
    "FINANCIAL REVIEW",
    "Net debt",
    "52 weeks ended",
    "28 Mar 26",
    "£m",
    "29 Mar 25",
    "£m",
    "Change vs",
    "2024/25",
    "£m",
    "Group net debt(2,411.8)(1,779.8)(632.0)"
  ].join("\n"), 117);

  assert.equal(
    selectPrimaryFinancialEvidence("Why did Group net debt increase?", rows),
    null
  );
});


test("extracts the requested M&S liquidity composition from the earliest matching disclosure", () => {
  const blocks = [
    {
      id: "pdf-24-10", index: 10, page: 24, section: "PDF page 24",
      text: "At 28 March 2026, the Group had liquidity of £1,872.1m (2024/25: £1,739.5m), comprising cash and cash equivalents of £997.2m (2024/25: £864.5m), an undrawn committed syndicated bank revolving credit facility of £850.0m (set to mature in December 2030), and undrawn uncommitted facilities amounting to £25.0m."
    },
    {
      id: "pdf-145-88", index: 88, page: 145, section: "PDF page 145",
      text: "At 28 March 2026, total liquidity was £1,872.2m, comprising cash and cash equivalents of £997.2m, an undrawn committed syndicated bank revolving credit facility of £850.0m and undrawn uncommitted facilities amounting to £25.0m."
    }
  ];

  const result = selectLiquidityEvidence(
    "At 28 March 2026, what made up Marks and Spencer Group plc total liquidity? Break down each component and its amount.",
    blocks
  );

  assert.ok(result);
  assert.equal(result.row.page, 24);
  assert.equal(result.row.id, "pdf-24-10");
  assert.equal(result.period, "28 March 2026");
  assert.deepEqual(result.components, [
    { label: "Cash and cash equivalents", amount: "£997.2m" },
    { label: "Undrawn committed syndicated bank revolving credit facility", amount: "£850.0m" },
    { label: "Undrawn uncommitted facilities", amount: "£25.0m" }
  ]);
  assert.match(result.answer, /Total liquidity: £1,872.1m/);
  assert.equal(result.sourceQuote, blocks[0].text);
});

test("liquidity extraction joins a disclosure split across PDF text blocks on the same page", () => {
  const blocks = [
    { id: "p24-a", index: 10, page: 24, section: "PDF page 24", text: "At 28 March 2026, the Group had liquidity of £1,872.1m (2024/25: £1,739.5m)," },
    { id: "p24-b", index: 11, page: 24, section: "PDF page 24", text: "comprising cash and cash equivalents of £997.2m (2024/25: £864.5m)," },
    { id: "p24-c", index: 12, page: 24, section: "PDF page 24", text: "an undrawn committed syndicated bank revolving credit facility of £850.0m (set to mature in December 2030)," },
    { id: "p24-d", index: 13, page: 24, section: "PDF page 24", text: "and undrawn uncommitted facilities amounting to £25.0m." }
  ];

  const result = selectLiquidityEvidence(
    "At 28 March 2026, what made up total liquidity? Break down each component.",
    blocks
  );

  assert.ok(result);
  assert.equal(result.row.page, 24);
  assert.equal(result.row.id, "p24-a");
  assert.match(result.sourceQuote, /liquidity of £1,872\.1m/);
  assert.match(result.sourceQuote, /cash and cash equivalents of £997\.2m/);
  assert.match(result.sourceQuote, /undrawn committed syndicated bank revolving credit facility of £850\.0m/);
  assert.match(result.sourceQuote, /undrawn uncommitted facilities amounting to £25\.0m/);
});

test("liquidity extraction respects the requested date and fails closed on incomplete or inconsistent passages", () => {
  const base = "At 28 March 2026, the Group had liquidity of £1,872.1m, comprising cash and cash equivalents of £997.2m, an undrawn committed syndicated bank revolving credit facility of £850.0m, and undrawn uncommitted facilities amounting to £25.0m.";
  const block = (text, page = 24) => [{ id: "p", index: 0, page, section: "PDF", text }];

  assert.equal(
    selectLiquidityEvidence("What made up liquidity at 29 March 2025?", block(base)),
    null
  );
  assert.equal(
    selectLiquidityEvidence("Break down total liquidity at 28 March 2026", block(base.replace("£25.0m", "£250.0m"))),
    null
  );
  assert.equal(
    selectLiquidityEvidence("Break down total liquidity at 28 March 2026", block(base.replace(", and undrawn uncommitted facilities amounting to £25.0m", ""))),
    null
  );
  assert.equal(
    selectLiquidityEvidence("Why did liquidity change at 28 March 2026?", block(base)),
    null
  );
});
