import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { nightCounts, readNight } from '../src/digest/read.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('reads 5 jobs sorted by job, and counts the 1 bad line', () => {
    expect(night).not.toBeNull();
    expect(night?.badLines).toBe(1);
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('builds each row: runs, retries, last status, last error, first/last as logged', () => {
    const byJob = new Map(night?.rows.map((r) => [r.job, r]));
    expect(byJob.get('fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      first: '2026-10-29T01:30:00+01:00',
      last: '2026-10-29T01:37:00+01:00',
    });
    expect(byJob.get('lane/sync')).toMatchObject({
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'lock held',
      first: '2026-10-28T23:00:06+01:00',
      last: '2026-10-29T05:00:04+01:00',
    });
    expect(byJob.get('notes/backup')).toMatchObject({ runs: 1, lastStatus: 'fail', lastError: 'quota exceeded' });
    expect(byJob.get('digest/render')).toMatchObject({ owner: null, runs: 1, lastError: null });
  });

  it('counts lines per status', () => {
    expect(nightCounts('runs', '2026-10-28')).toEqual({ ok: 10, retry: 4, fail: 1 });
  });
});

describe('readNight edge cases (temp runs dir)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('missing file -> null', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
    expect(nightCounts(dir, '2026-01-01')).toBeNull();
  });

  it('empty file -> no rows, no bad lines', () => {
    writeFileSync(join(dir, '2026-01-02.jsonl'), '');
    expect(readNight(dir, '2026-01-02')).toEqual({ rows: [], badLines: 0 });
    expect(nightCounts(dir, '2026-01-02')).toEqual({ ok: 0, retry: 0, fail: 0 });
  });

  it('blank lines are skipped; malformed or invalid lines are counted, never thrown', () => {
    const lines = [
      '{"at":"2026-01-03T01:00:00+02:00","job":"b","status":"ok","owner":"x"}',
      '',
      'not json',
      '[1,2]',
      '{"at":"2026-01-03T01:00:00+02:00","job":"b","status":"weird","owner":"x"}',
      '{"job":"b","status":"ok","owner":"x"}',
      '{"at":"2026-01-03T00:30:00+02:00","job":"a","status":"retry","owner":null,"error":"e1"}',
      '{"at":"2026-01-03T00:10:00+02:00","job":"a","status":"ok","owner":null}',
    ];
    writeFileSync(join(dir, '2026-01-03.jsonl'), lines.join('\r\n') + '\r\n\r\n');
    const night = readNight(dir, '2026-01-03');
    expect(night?.badLines).toBe(4);
    expect(night?.rows.map((r) => r.job)).toEqual(['a', 'b']);
    // first/last follow file position (append-only log), not timestamp order
    expect(night?.rows[0]).toEqual({
      job: 'a',
      owner: null,
      runs: 2,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'e1',
      first: '2026-01-03T00:30:00+02:00',
      last: '2026-01-03T00:10:00+02:00',
    });
  });

  it('a night that is not YYYY-MM-DD -> null (no path escape)', () => {
    expect(readNight(dir, '../etc')).toBeNull();
  });
});
