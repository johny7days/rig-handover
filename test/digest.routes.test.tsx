import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestRow } from '../src/digest/types.js';

// Plan morning-digest § 2d: route tests for the digest page (§ 2a) and JSON (§ 2b).
// Uses its own temp runs dir with small fixtures; runs/ is never touched.

const base = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

type DigestJson = { night: string; rows: DigestRow[]; badLines: number };

const line = (at: string, job: string, status: string, owner: string | null, error?: string) =>
  JSON.stringify({ at, job, status, owner, ...(error ? { error } : {}) });

// Jobs are logged out of order on purpose: the page and the JSON must sort them by job.
const FULL_NIGHT = [
  line('2026-10-28T23:00:06+01:00', 'lane/sync', 'ok', 'rook'),
  line('2026-10-28T23:10:00+01:00', 'notes/fail', 'fail', 'lane-07', 'quota exceeded'),
  line('2026-10-28T23:20:00+01:00', 'backup/nightly', 'ok', null),
  line('2026-10-28T23:30:00+01:00', 'fixtures/refresh', 'retry', 'rook', 'upstream 503'),
  line('2026-10-28T23:31:00+01:00', 'fixtures/refresh', 'retry', 'rook', 'upstream 503'),
  line('2026-10-28T23:32:00+01:00', 'fixtures/refresh', 'ok', 'rook'),
].join('\n') + '\n';

const BAD_LINE_NIGHT = [
  line('2026-10-30T01:00:00+01:00', 'alpha/job', 'ok', 'rook'),
  'this is not json {',
  line('2026-10-30T02:00:00+01:00', 'zeta/job', 'fail', 'lane-07', 'boom'),
].join('\n') + '\n';

let runsDir: string;
let config: typeof base;

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'digest-routes-'));
  writeFileSync(join(runsDir, '2026-10-28.jsonl'), FULL_NIGHT);
  writeFileSync(join(runsDir, '2026-10-29.jsonl'), '');
  writeFileSync(join(runsDir, '2026-10-30.jsonl'), BAD_LINE_NIGHT);
  config = { ...base, runsDir };
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

// Position of each job name in the page; -1 if missing.
function pageOrder(html: string, jobs: string[]): string[] {
  return jobs
    .map((job) => ({ job, at: html.indexOf(job) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.job);
}

const JOBS = ['backup/nightly', 'fixtures/refresh', 'lane/sync', 'notes/fail'];

describe('digest page GET /digest/:night', () => {
  it('returns 200 HTML with every job of the night, sorted by job', async () => {
    const res = await createApp(config).request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    for (const job of JOBS) expect(html).toContain(job);
    expect(pageOrder(html, JOBS)).toEqual(JOBS);
  });

  it('renders a null owner as the dash', async () => {
    const res = await createApp(config).request('/digest/2026-10-28');
    const html = await res.text();
    expect(html).toContain('—');
  });

  it('renders an empty night as "nothing ran"', async () => {
    const res = await createApp(config).request('/digest/2026-10-29');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
  });

  it('still renders a night with a bad line and shows the good rows', async () => {
    const res = await createApp(config).request('/digest/2026-10-30');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('alpha/job');
    expect(html).toContain('zeta/job');
  });

  it('returns 404 for a night with no file', async () => {
    const res = await createApp(config).request('/digest/2026-01-01');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a night that is not a date', async () => {
    const res = await createApp(config).request('/digest/abc');
    expect(res.status).toBe(404);
  });
});

describe('digest JSON GET /api/digest/:night', () => {
  it('returns 200 with night, rows and badLines', async () => {
    const res = await createApp(config).request('/api/digest/2026-10-28');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.night).toBe('2026-10-28');
    expect(body.badLines).toBe(0);
    expect(body.rows.map((r) => r.job)).toEqual(JOBS);
  });

  it('keeps the job order identical to the page', async () => {
    const page = await (await createApp(config).request('/digest/2026-10-28')).text();
    const body = (await (await createApp(config).request('/api/digest/2026-10-28')).json()) as DigestJson;
    expect(pageOrder(page, body.rows.map((r) => r.job))).toEqual(body.rows.map((r) => r.job));
  });

  it('keeps a null owner as null in the JSON', async () => {
    const body = (await (await createApp(config).request('/api/digest/2026-10-28')).json()) as DigestJson;
    const backup = body.rows.find((r) => r.job === 'backup/nightly');
    expect(backup?.owner).toBeNull();
  });

  it('returns empty rows for an empty night', async () => {
    const res = await createApp(config).request('/api/digest/2026-10-29');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('counts a bad line and keeps the other rows', async () => {
    const res = await createApp(config).request('/api/digest/2026-10-30');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['alpha/job', 'zeta/job']);
  });

  it('returns 404 for a night with no file', async () => {
    const res = await createApp(config).request('/api/digest/2026-01-01');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a night that is not a date', async () => {
    const res = await createApp(config).request('/api/digest/abc');
    expect(res.status).toBe(404);
  });
});
