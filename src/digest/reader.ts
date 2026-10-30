import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error: string | null;
};

function isRunStatus(value: unknown): value is RunStatus {
  return value === 'ok' || value === 'retry' || value === 'fail';
}

function parseLine(text: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { at, job, status, owner, error } = value as Record<string, unknown>;
  if (typeof at !== 'string' || typeof job !== 'string' || !isRunStatus(status)) return null;
  return {
    at,
    job,
    status,
    owner: typeof owner === 'string' ? owner : null,
    error: typeof error === 'string' ? error : null,
  };
}

function isMissingFile(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}

function readLog(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if (isMissingFile(err)) return null;
    throw err;
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  const log = readLog(join(runsDir, `${night}.jsonl`));
  if (log === null) return null;

  const rows = new Map<string, DigestRow>();
  const counts: Record<RunStatus, number> = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const text of log.split('\n')) {
    if (text.trim() === '') continue;
    const line = parseLine(text);
    if (line === null) {
      badLines += 1;
      continue;
    }
    counts[line.status] += 1;
    const row = rows.get(line.job);
    rows.set(line.job, {
      job: line.job,
      owner: line.owner,
      runs: (row?.runs ?? 0) + 1,
      retries: (row?.retries ?? 0) + (line.status === 'retry' ? 1 : 0),
      lastStatus: line.status,
      lastError: line.error,
      firstAt: row?.firstAt ?? line.at,
      lastAt: line.at,
    });
  }

  const sorted = [...rows.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { rows: sorted, badLines, counts };
};
