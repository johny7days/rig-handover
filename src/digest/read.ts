// Plan morning-digest § 1: runs/<night>.jsonl -> one row per job.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, Night, NightCounts, ReadNight, RunStatus } from './types.js';

// One valid line of the log, after parsing at the edge.
type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error: string | null;
};

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;

function isStatus(value: unknown): value is RunStatus {
  return value === 'ok' || value === 'retry' || value === 'fail';
}

// null = the line is bad (not JSON, not an object, or a field of the wrong shape).
function parseLine(text: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.at !== 'string' || o.at === '') return null;
  if (typeof o.job !== 'string' || o.job === '') return null;
  if (!isStatus(o.status)) return null;
  if (o.owner !== undefined && o.owner !== null && typeof o.owner !== 'string') return null;
  if (o.error !== undefined && o.error !== null && typeof o.error !== 'string') return null;
  return {
    at: o.at,
    job: o.job,
    status: o.status,
    owner: typeof o.owner === 'string' ? o.owner : null,
    error: typeof o.error === 'string' ? o.error : null,
  };
}

type Parsed = { lines: RunLine[]; badLines: number };

// Reads and parses the night's file. null = no file (or a night that isn't YYYY-MM-DD).
function readLines(runsDir: string, night: string): Parsed | null {
  if (!NIGHT.test(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const lines: RunLine[] = [];
  let badLines = 0;
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim(); // also drops \r from CRLF files
    if (trimmed === '') continue; // blank lines (e.g. the trailing newline) are not bad lines
    const line = parseLine(trimmed);
    if (line) lines.push(line);
    else badLines += 1;
  }
  return { lines, badLines };
}

// The log is append-only, so "first" and "last" follow position in the file, not `at`.
export const readNight: ReadNight = (runsDir, night) => {
  const parsed = readLines(runsDir, night);
  if (!parsed) return null;
  const byJob = new Map<string, DigestRow>();
  for (const line of parsed.lines) {
    const row = byJob.get(line.job);
    if (!row) {
      byJob.set(line.job, {
        job: line.job,
        owner: line.owner,
        runs: 1,
        retries: line.status === 'retry' ? 1 : 0,
        lastStatus: line.status,
        lastError: line.error,
        first: line.at,
        last: line.at,
      });
      continue;
    }
    row.owner = line.owner;
    row.runs += 1;
    if (line.status === 'retry') row.retries += 1;
    row.lastStatus = line.status;
    if (line.error !== null) row.lastError = line.error;
    row.last = line.at;
  }
  const rows = [...byJob.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  const result: Night = { rows, badLines: parsed.badLines };
  return result;
};

// Lines per status for the board (§ 2c). Bad lines aren't counted. null = no file.
export function nightCounts(runsDir: string, night: string): NightCounts | null {
  const parsed = readLines(runsDir, night);
  if (!parsed) return null;
  const counts: NightCounts = { ok: 0, retry: 0, fail: 0 };
  for (const line of parsed.lines) counts[line.status] += 1;
  return counts;
}
