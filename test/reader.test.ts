import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';
import type { DigestRow, NightDigest } from '../src/digest/types.js';

const tempDirs: string[] = [];

function tempRuns(night: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, `${night}.jsonl`), content);
  return dir;
}

function read(content: string): NightDigest {
  const digest = readNight(tempRuns('night', content), 'night');
  if (digest === null) throw new Error('expected a digest');
  return digest;
}

function line(fields: Record<string, unknown>): string {
  return JSON.stringify({ at: '2026-10-29T01:00:00+01:00', job: 'a', status: 'ok', owner: 'rook', ...fields });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readNight on 2026-10-28', () => {
  const digest = readNight('runs', '2026-10-28');
  if (digest === null) throw new Error('expected the night on disk');
  const row = (job: string): DigestRow | undefined => digest.rows.find((r) => r.job === job);

  it('has 5 jobs, sorted, and 1 bad line', () => {
    expect(digest.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(digest.badLines).toBe(1);
  });

  it('counts parsed lines per status', () => {
    expect(digest.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('fixtures/refresh recovered: last line decides status and error', () => {
    expect(row('fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('notes/backup failed with its error', () => {
    expect(row('notes/backup')).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('digest/render keeps its row with a null owner', () => {
    expect(row('digest/render')).toMatchObject({ owner: null, runs: 1 });
  });
});

describe('readNight edges', () => {
  it('returns null for a night with no file', () => {
    expect(readNight('runs', '1999-01-01')).toBeNull();
  });

  it('throws on read errors other than a missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, 'night.jsonl'));
    expect(() => readNight(dir, 'night')).toThrow();
  });

  it('reads an empty file as an empty night', () => {
    expect(read('')).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('does not count blank lines as bad', () => {
    const digest = read(`\n${line({})}\n   \n\r\n${line({})}\r\n\n`);
    expect(digest.badLines).toBe(0);
    expect(digest.rows[0]?.runs).toBe(2);
  });

  it.each([
    ['broken json', '{"at":"x","job":'],
    ['a json array', '[]'],
    ['json null', 'null'],
    ['a json string', '"ok"'],
    ['no job', JSON.stringify({ at: 'x', status: 'ok', owner: null })],
    ['a job that is no string', line({ job: 7 })],
    ['no at', JSON.stringify({ job: 'a', status: 'ok', owner: null })],
    ['an at that is no string', line({ at: 1761696000 })],
    ['no status', JSON.stringify({ at: 'x', job: 'a', owner: null })],
    ['a status out of the set', line({ status: 'skipped' })],
  ])('counts %s as a bad line and leaves it out', (_name, bad) => {
    const digest = read(`${bad}\n${line({ job: 'good' })}\n`);
    expect(digest.badLines).toBe(1);
    expect(digest.rows.map((r) => r.job)).toEqual(['good']);
    expect(digest.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it('sorts by code unit, not by locale', () => {
    const jobs = ['b', 'a', 'Z', 'é', '_'];
    const digest = read(jobs.map((job) => line({ job })).join('\n'));
    expect(digest.rows.map((r) => r.job)).toEqual(['Z', '_', 'a', 'b', 'é']);
  });

  it('takes owner and error from the last line only, in file order', () => {
    const digest = read(
      [
        line({ at: '2026-10-29T09:00:00+09:00', status: 'fail', owner: 'first', error: 'early' }),
        line({ at: '2026-10-29T01:00:00-05:00', status: 'retry', owner: 'last' }),
      ].join('\n'),
    );
    expect(digest.rows).toEqual([
      {
        job: 'a',
        owner: 'last',
        runs: 2,
        retries: 1,
        lastStatus: 'retry',
        lastError: null,
        firstAt: '2026-10-29T09:00:00+09:00',
        lastAt: '2026-10-29T01:00:00-05:00',
      },
    ]);
  });

  it('copes with job names that are object keys', () => {
    const digest = read([line({ job: '__proto__' }), line({ job: 'constructor' })].join('\n'));
    expect(digest.rows.map((r) => r.job)).toEqual(['__proto__', 'constructor']);
    expect(digest.rows[0]?.runs).toBe(1);
  });
});
