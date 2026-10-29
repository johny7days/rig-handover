// Plan morning-digest § 1. The contract for the run log reader; every part of § 2 builds on it.
// One line of runs/<night>.jsonl: { at, job, status, owner, error? }.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One row per job in the night.
export type DigestRow = {
  job: string;
  owner: string | null; // null in the log stays null; views show it as `—`
  runs: number; // lines for this job
  retries: number; // lines with status `retry`
  lastStatus: RunStatus; // status of the job's latest line
  lastError: string | null; // most recent `error` seen for the job, null if none
  first: string; // `at` of the earliest line, exactly as logged (offset kept)
  last: string; // `at` of the latest line, exactly as logged (offset kept)
};

export type Night = {
  rows: DigestRow[]; // sorted by job
  badLines: number; // lines that don't parse: counted, never thrown
};

// Per-night status counts for the board (§ 2c): lines per status.
export type NightCounts = Record<RunStatus, number>;

// Reads runsDir/<night>.jsonl.
// - null: no file for this night (the route returns 404).
// - { rows: [], badLines: 0 }: the file exists but is empty ("nothing ran").
// Implementation: issue #2.
export type ReadNight = (runsDir: string, night: string) => Night | null;
