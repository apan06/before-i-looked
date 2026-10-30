import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

let runsDir: string;
let config: { adapter: string; installed: string; beatEverySeconds: number; runsDir: string };

const line = (job: string, status: string, owner: string | null) =>
  JSON.stringify({ at: '2026-01-01T01:00:00+01:00', job, status, owner });

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-'));
  writeFileSync(
    join(runsDir, '2026-01-01.jsonl'),
    [
      line('b/job', 'ok', 'rook'),
      line('b/job', 'ok', 'rook'),
      JSON.stringify({ at: '2026-01-01T02:00:00+01:00', job: 'a/job', status: 'fail', owner: null, error: 'boom' }),
    ].join('\n') + '\n',
  );
  writeFileSync(join(runsDir, '2026-01-02.jsonl'), '');
  writeFileSync(
    join(runsDir, '2026-01-03.jsonl'),
    [line('a/job', 'ok', 'rook'), '{"at":"cut'].join('\n') + '\n',
  );
  config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir };
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

type DigestJson = {
  night: string;
  rows: Array<{ job: string; owner: string | null }>;
  badLines: number;
  counts: Record<string, number>;
};

describe('digest routes', () => {
  it('renders a night with rows sorted by job', async () => {
    const app = createApp(config);
    const page = await app.request('/digest/2026-01-01');
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('a/job');
    expect(html).toContain('b/job');
    expect(html.indexOf('a/job')).toBeLessThan(html.indexOf('b/job'));
    expect(html).toContain('—');

    const res = await app.request('/api/digest/2026-01-01');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.night).toBe('2026-01-01');
    expect(body.rows.map((r) => r.job)).toEqual(['a/job', 'b/job']);
    expect(body.rows[0].owner).toBeNull();
  });

  it('returns 404 for a night with no file', async () => {
    const app = createApp(config);
    expect((await app.request('/digest/2026-09-09')).status).toBe(404);
    expect((await app.request('/api/digest/2026-09-09')).status).toBe(404);
  });

  it('returns 404 for a malformed night', async () => {
    const app = createApp(config);
    expect((await app.request('/digest/not-a-night')).status).toBe(404);
    expect((await app.request('/api/digest/not-a-night')).status).toBe(404);
  });

  it('renders an empty night as nothing ran', async () => {
    const app = createApp(config);
    const page = await app.request('/digest/2026-01-02');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('nothing ran');

    const res = await app.request('/api/digest/2026-01-02');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('keeps the good lines of a night with a cut line', async () => {
    const app = createApp(config);
    const page = await app.request('/digest/2026-01-03');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('a/job');

    const res = await app.request('/api/digest/2026-01-03');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.badLines).toBe(1);
    expect(body.rows).toHaveLength(1);
  });

  it('shows the jobs in the same order in the page and the JSON', async () => {
    const app = createApp(config);
    const html = await (await app.request('/digest/2026-01-01')).text();
    const body = (await (await app.request('/api/digest/2026-01-01')).json()) as DigestJson;
    const positions = body.rows.map((r) => html.indexOf(r.job));
    positions.forEach((pos) => expect(pos).toBeGreaterThanOrEqual(0));
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
  });
});
