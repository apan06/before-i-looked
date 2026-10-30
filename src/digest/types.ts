export type RunStatus = 'ok' | 'retry' | 'fail';

// One job's night. Times keep the offset from the log.
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  // Sorted by job. The page and the JSON both show them in this order.
  rows: DigestRow[];
  // Lines that did not parse.
  badLines: number;
  // Lines per status.
  counts: Record<RunStatus, number>;
};

// null = the night has no file. An empty file is a NightDigest with no rows.
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
