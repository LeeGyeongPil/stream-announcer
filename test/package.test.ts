// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { MESSAGES, parseArgs, resolveLang } from '../examples/replay.mjs';

// vitest runs from the package root
const root = process.cwd();
const path = (p: string): string => join(root, p);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** Run the example with a controlled environment (no inherited language variables). */
function runExample(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [path('examples/replay.mjs'), ...args], {
    cwd: path('.'),
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

beforeAll(() => {
  if (!existsSync(path('dist/index.js'))) {
    execFileSync(npm, ['run', 'build'], { cwd: path('.'), stdio: 'ignore' });
  }
}, 120_000);

describe('package build', () => {
  it('emits ESM and type declarations for every entry point', () => {
    for (const entry of ['dist/index', 'dist/react/index', 'dist/testing/index']) {
      expect(existsSync(path(`${entry}.js`)), `${entry}.js`).toBe(true);
      expect(existsSync(path(`${entry}.d.ts`)), `${entry}.d.ts`).toBe(true);
    }
  });

  it('keeps React out of the core and the testing helpers', () => {
    for (const file of ['dist/index.js', 'dist/announcer.js', 'dist/live-region.js', 'dist/testing/index.js']) {
      expect(readFileSync(path(file), 'utf8')).not.toMatch(/from ['"]react/);
    }
    expect(readFileSync(path('dist/react/index.js'), 'utf8')).toMatch(/from 'react'/);
  });

  it('declares exports for ".", "./react" and "./testing"', () => {
    const pkg = JSON.parse(readFileSync(path('package.json'), 'utf8'));
    expect(Object.keys(pkg.exports)).toEqual(expect.arrayContaining(['.', './react', './testing']));
    expect(pkg.peerDependenciesMeta.react.optional).toBe(true);
    expect(pkg.license).toBe('MIT');
  });

  it('packs README.md, README.ko.md and LICENSE but no tests', () => {
    const json = execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: path('.'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const files: string[] = JSON.parse(json)[0].files.map((f: { path: string }) => f.path);
    expect(files).toEqual(expect.arrayContaining(['README.md', 'README.ko.md', 'LICENSE', 'dist/index.js']));
    expect(files.some((f) => f.startsWith('test/') || f.startsWith('demo/'))).toBe(false);
  });
});

describe('example CLI', () => {
  it('prints the Korean announcement order with --lang ko', () => {
    const { code, out } = runExample(['--lang', 'ko', '--mode', 'sentence', '--fixture', 'ko-basic']);
    expect(code).toBe(0);
    const order = ['응답을 생성하는 중입니다.', '파이는 약 3.14입니다.', '응답이 완료되었습니다.'].map((t) => out.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('prints the English announcement order with --lang en', () => {
    const { code, out } = runExample(['--lang', 'en']);
    expect(code).toBe(0);
    expect(out).toContain('Generating response.');
    expect(out.indexOf('Generating response.')).toBeLessThan(out.indexOf('Response complete.'));
    expect(out).toContain('python code block, 2 lines.');
  });

  it('rejects a bad --lang with exit code 2', () => {
    const { code, err } = runExample(['--lang', 'xx']);
    expect(code).toBe(2);
    expect(err.trim()).toBe('error: --lang must be en or ko');
    const ko = runExample(['--lang', 'xx'], { LANG: 'ko_KR.UTF-8' });
    expect(ko.code).toBe(2);
    expect(ko.err).toContain('--lang 값은 en 또는 ko');
  });

  it('rejects unknown options, modes, fixtures and missing values with exit code 2', () => {
    expect(runExample(['--nope']).code).toBe(2);
    expect(runExample(['--mode', 'loud']).err).toContain('--mode must be');
    expect(runExample(['--fixture', 'missing']).err).toContain('Available:');
    expect(runExample(['--lang']).err).toContain('--lang needs a value');
    expect(runExample(['--interval', '-5']).code).toBe(2);
  });

  it('shows help in the chosen language', () => {
    expect(runExample(['--help']).out).toContain('Usage:');
    expect(runExample(['--help', '--lang', 'ko']).out).toContain('사용법:');
  });

  it('resolves the language: --lang > STREAM_ANNOUNCER_LANG > LC_ALL > LC_MESSAGES > LANG', () => {
    expect(resolveLang('en', { STREAM_ANNOUNCER_LANG: 'ko' })).toBe('en');
    expect(resolveLang(undefined, { STREAM_ANNOUNCER_LANG: 'ko', LANG: 'en_US.UTF-8' })).toBe('ko');
    expect(resolveLang(undefined, { LC_ALL: 'ko_KR.UTF-8', LANG: 'en_US.UTF-8' })).toBe('ko');
    expect(resolveLang(undefined, { LC_MESSAGES: 'ko_KR.UTF-8', LANG: 'en_US.UTF-8' })).toBe('ko');
    expect(resolveLang(undefined, { LANG: 'ko_KR.UTF-8' })).toBe('ko');
    expect(resolveLang(undefined, { LANG: 'fr_FR.UTF-8' })).toBe('en');
    expect(resolveLang(undefined, {})).toBe('en');
  });

  it('uses the environment variable end to end', () => {
    expect(runExample([], { STREAM_ANNOUNCER_LANG: 'ko' }).out).toContain('응답이 완료되었습니다.');
    expect(runExample([], { LANG: 'ko_KR.UTF-8' }).out).toContain('응답이 완료되었습니다.');
    expect(runExample([], { LANG: 'C' }).out).toContain('Response complete.');
  });

  it('defines the same message keys in en and ko', () => {
    expect(Object.keys(MESSAGES.en).sort()).toEqual(Object.keys(MESSAGES.ko).sort());
  });

  it('parses --name=value and reports problems', () => {
    expect(parseArgs(['--lang=ko', '--interval=10']).lang).toBe('ko');
    expect(parseArgs(['--interval', 'abc']).error?.[0]).toBe('intervalInvalid');
  });
});
