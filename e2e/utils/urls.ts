import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const gitOutput = (args: string[]): string => execFileSync('git', args, { encoding: 'utf-8' }).trim();

// Mirrors resources/instanced/instance.sh: the main worktree is instance 1, and a linked worktree
// keeps the number recorded in its .workdir/instance.
const resolveLocalInstance = (): number | null => {
  try {
    if (
      gitOutput(['rev-parse', '--path-format=absolute', '--git-dir']) ===
      gitOutput(['rev-parse', '--path-format=absolute', '--git-common-dir'])
    ) {
      return 1;
    }

    const claimed = readFileSync(
      join(gitOutput(['rev-parse', '--show-toplevel']), '.workdir', 'instance'),
      'utf-8'
    ).trim();

    return /^[1-9][0-9]*$/.test(claimed) ? Number(claimed) : null;
  } catch {
    return null;
  }
};

const LOCAL_INSTANCE = resolveLocalInstance();

const resolveLocalOrigin = (): string =>
  LOCAL_INSTANCE === null ? 'http://localhost:8080' : `http://localhost:${8080 + LOCAL_INSTANCE * 100}`;

const ORIGIN = process.env.E2E_BASE_URL ?? resolveLocalOrigin();

const stripTrailingSlash = (value: string): string => value.replace(/\/$/, '');

export const BASE_URL = stripTrailingSlash(ORIGIN);

export const webRoute = (path: string): string => `${BASE_URL}${path}`;
