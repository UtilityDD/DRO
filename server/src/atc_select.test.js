const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectAtcCirculars, periodFromName } = require('./atc_select');

function row(over = {}) {
  return {
    period_label: "May'26",
    source_format: 'IA',
    office_code: '3412502',
    office_type: 'ccc',
    point_source: 'achievement',
    input_mu: 10,
    atc_loss: 6,
    ...over,
  };
}

test('periodFromName reads May 26 from messy filenames', () => {
  assert.equal(periodFromName("1.1A CCCWISE ATC LOSS May'26_final_.xlsx"), "May'26");
  assert.equal(periodFromName('ATC-Apr-2025.xlsx'), "Apr'25");
});

test('keeps Excl and Incl for the same month from different files', () => {
  const picked = selectAtcCirculars([
    {
      filename: 'ccc-may.xlsx',
      rows: [
        row({ office_type: 'ccc' }),
        row({ office_code: '3412', office_type: 'division', input_mu: 40 }),
      ],
    },
    {
      filename: 'div-may.xlsx',
      rows: [row({ source_format: 'IB', office_code: '3412', office_type: 'division', input_mu: 42 })],
    },
  ]);
  assert.equal(picked.keep.length, 2);
  assert.equal(picked.achievementRows.length, 3);
  assert.equal(picked.skip.length, 0);
});

test('duplicate month keeps the fuller circular and skips the other', () => {
  const picked = selectAtcCirculars([
    {
      filename: 'thin-may.xlsx',
      lastModified: 1,
      rows: [row({ input_mu: null, office_type: 'ccc' })],
    },
    {
      filename: "May'26_final.xlsx",
      lastModified: 2,
      rows: [
        row({ input_mu: 12 }),
        row({ office_code: '3412', office_type: 'division', input_mu: 80 }),
      ],
    },
  ]);
  assert.equal(picked.keep.length, 1);
  assert.equal(picked.keep[0].filename, "May'26_final.xlsx");
  assert.ok(picked.skip.some((s) => s.filename === 'thin-may.xlsx' && /Duplicate/.test(s.reason)));
});

test('header months are ignored when a real circular exists', () => {
  const picked = selectAtcCirculars([
    {
      filename: 'mar-circular.xlsx',
      rows: [
        row({ period_label: "Mar'26", input_mu: 9, office_type: 'ccc' }),
        row({ period_label: "Mar'26", office_code: '3412', office_type: 'division', input_mu: 50 }),
      ],
    },
    {
      filename: 'may-circular.xlsx',
      rows: [
        row({ period_label: "May'26", input_mu: 11, office_type: 'ccc' }),
        row({
          period_label: "Mar'26",
          point_source: 'header_month',
          input_mu: null,
          atc_loss: 5,
        }),
      ],
    },
  ]);
  const mar = picked.keep.filter((k) => k.period === "Mar'26");
  assert.equal(mar.length, 1);
  assert.equal(mar[0].filename, 'mar-circular.xlsx');
  assert.equal(picked.headerMonths.length, 0);
});

test('skips non-AT&C and out-of-scope dumps', () => {
  const picked = selectAtcCirculars([
    { filename: 'notes.pdf', skipped: 'Not Excel' },
    { filename: 'nsc.xlsx', rows: [], filtered_out: 0 },
    { filename: 'other-zone.xlsx', rows: [], filtered_out: 400 },
  ]);
  assert.equal(picked.keep.length, 0);
  assert.equal(picked.skip.length, 3);
});
