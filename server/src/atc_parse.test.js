const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeAtcSnapshots, isFullAchievement, isHeaderMonthPoint, atcNaturalKey } = require('./atc_parse');

test('header_month never overwrites a full achievement row', () => {
  const existing = [
    {
      id: 1,
      period_label: "Mar'26",
      source_format: 'IA',
      office_code: '3412502',
      point_source: 'achievement',
      atc_loss: 6.5,
      input_mu: 100,
      created_at: '2026-04-01T00:00:00.000Z',
    },
  ];
  const { applied, skippedHeader } = mergeAtcSnapshots(existing, [
    {
      period_label: "Mar'26",
      source_format: 'IA',
      office_code: '3412502',
      point_source: 'header_month',
      atc_loss: 6.1,
      input_mu: null,
    },
  ]);
  assert.equal(skippedHeader, 1);
  assert.equal(applied.length, 0);
  assert.equal(existing[0].atc_loss, 6.5);
  assert.equal(existing[0].input_mu, 100);
  assert.equal(existing[0].created_at, '2026-04-01T00:00:00.000Z');
});

test('header_month fills a gap when the month is empty', () => {
  const existing = [];
  const { applied, skippedHeader } = mergeAtcSnapshots(existing, [
    {
      period_label: "May'25",
      source_format: 'IA',
      office_code: '3412502',
      point_source: 'header_month',
      atc_loss: 8.2,
    },
  ]);
  assert.equal(skippedHeader, 0);
  assert.equal(applied.length, 1);
  assert.equal(existing.length, 1);
  assert.equal(existing[0].atc_loss, 8.2);
});

test('achievement overwrites a header_month stub', () => {
  const existing = [
    {
      id: 9,
      period_label: "May'26",
      source_format: 'IB',
      office_code: '3412',
      point_source: 'header_month',
      atc_loss: 7,
      input_mu: null,
      created_at: '2026-05-01T00:00:00.000Z',
    },
  ];
  const { applied } = mergeAtcSnapshots(existing, [
    {
      period_label: "May'26",
      source_format: 'IB',
      office_code: '3412',
      point_source: 'achievement',
      atc_loss: 6.8,
      input_mu: 55,
    },
  ]);
  assert.equal(applied.length, 1);
  assert.equal(existing[0].id, 9);
  assert.equal(existing[0].point_source, 'achievement');
  assert.equal(existing[0].input_mu, 55);
  assert.equal(existing[0].created_at, '2026-05-01T00:00:00.000Z');
});

test('legacy rows with MU are treated as achievement', () => {
  const row = { office_code: '3414', input_mu: 12, point_source: null };
  assert.equal(isHeaderMonthPoint(row), false);
  assert.equal(isFullAchievement(row), true);
  assert.equal(atcNaturalKey({ period_label: "May'26", office_code: '3414' }), "May'26|IA|3414");
});

test('duplicate incoming keys produce one applied row', () => {
  const { applied, existing } = mergeAtcSnapshots([], [
    {
      period_label: "May'26",
      source_format: 'IA',
      office_code: '3412502',
      point_source: 'achievement',
      atc_loss: 6.1,
      input_mu: 10,
    },
    {
      period_label: "May'26",
      source_format: 'IA',
      office_code: '3412502',
      point_source: 'achievement',
      atc_loss: 6.4,
      input_mu: 12,
    },
  ]);
  assert.equal(applied.length, 1);
  assert.equal(existing.length, 1);
  assert.equal(existing[0].atc_loss, 6.4);
  assert.equal(existing[0].input_mu, 12);
});
