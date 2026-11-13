// Replays a recorded chunk fixture through stream-announcer and prints what a screen reader would hear.
// Practice mock: the chunks come from the examples/fixtures folder, not from a real LLM.
//
// Usage: node examples/replay.mjs [--lang en|ko] [--mode sentence|on-complete|off]
//                                 [--fixture <name>] [--interval <ms>]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');
const distDir = join(here, '..', 'dist');

/** All user-facing texts of this example, per language. Both languages define the same keys. */
export const MESSAGES = {
  en: {
    usage: [
      'Usage: node examples/replay.mjs [options]',
      '',
      'Replay a recorded chunk fixture and print what a screen reader would hear.',
      '(Practice mock: recorded chunks, not a real LLM.)',
      '',
      'Options:',
      '  --lang en|ko                          output language (default: STREAM_ANNOUNCER_LANG, then LANG)',
      '  --mode sentence|on-complete|off       announcement mode (default: sentence)',
      '  --fixture <name>                      fixture in examples/fixtures (default: follows --lang)',
      '  --interval <ms>                       wait between chunks (default: 0)',
      '  -h, --help                            show this help',
    ].join('\n'),
    header: 'Replaying fixture "{fixture}" in {mode} mode (practice mock: recorded chunks, not a real LLM).',
    heard: 'A screen reader would hear:',
    langInvalid: '--lang must be en or ko',
    modeInvalid: '--mode must be sentence, on-complete or off',
    intervalInvalid: '--interval must be a non-negative number of milliseconds',
    fixtureUnknown: 'unknown fixture "{fixture}". Available: {available}',
    optionUnknown: 'unknown option "{option}". Run with --help to see the options',
    valueMissing: '{option} needs a value',
    distMissing: 'dist/ is missing. Run "npm run build" first (or use "npm run example")',
  },
  ko: {
    usage: [
      '사용법: node examples/replay.mjs [옵션]',
      '',
      '녹화된 청크 픽스처를 재생해 화면 낭독기가 듣게 될 내용을 출력합니다.',
      '(연습용 목: 녹화된 청크이며 실제 LLM이 아닙니다.)',
      '',
      '옵션:',
      '  --lang en|ko                          출력 언어 (기본: STREAM_ANNOUNCER_LANG, 그다음 LANG)',
      '  --mode sentence|on-complete|off       낭독 모드 (기본: sentence)',
      '  --fixture <이름>                      examples/fixtures 의 픽스처 (기본: --lang 에 따름)',
      '  --interval <ms>                       청크 사이 대기 시간 (기본: 0)',
      '  -h, --help                            이 도움말 보기',
    ].join('\n'),
    header: '픽스처 "{fixture}" 를 {mode} 모드로 재생합니다 (연습용 목: 녹화된 청크이며 실제 LLM이 아닙니다).',
    heard: '화면 낭독기가 듣게 될 내용:',
    langInvalid: '--lang 값은 en 또는 ko 여야 합니다',
    modeInvalid: '--mode 값은 sentence, on-complete, off 중 하나여야 합니다',
    intervalInvalid: '--interval 값은 0 이상의 밀리초 숫자여야 합니다',
    fixtureUnknown: '알 수 없는 픽스처 "{fixture}". 사용 가능: {available}',
    optionUnknown: '알 수 없는 옵션 "{option}". --help 로 옵션을 확인하세요',
    valueMissing: '{option} 에 값이 필요합니다',
    distMissing: 'dist/ 가 없습니다. 먼저 "npm run build" 를 실행하세요 ("npm run example" 도 가능)',
  },
};

const MODES = ['sentence', 'on-complete', 'off'];

const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));

/** Language from a locale-like value: ko* -> ko, anything else -> en, empty -> undefined. */
function fromLocale(value) {
  if (!value) return undefined;
  return /^ko([-_.@]|$)/i.test(value.trim()) ? 'ko' : 'en';
}

/**
 * Pick the output language: --lang > STREAM_ANNOUNCER_LANG > LC_ALL > LC_MESSAGES > LANG.
 * Anything that is not Korean means English.
 */
export function resolveLang(flag, env = process.env) {
  if (flag === 'en' || flag === 'ko') return flag;
  return (
    fromLocale(env.STREAM_ANNOUNCER_LANG) ??
    fromLocale(env.LC_ALL) ??
    fromLocale(env.LC_MESSAGES) ??
    fromLocale(env.LANG) ??
    'en'
  );
}

/** Parse argv into plain values. Problems are returned as { error: [messageKey, values] }. */
export function parseArgs(argv) {
  const out = { lang: undefined, mode: 'sentence', fixture: undefined, interval: 0, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      out.help = true;
      continue;
    }
    const [name, inline] = arg.startsWith('--') ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    if (!['--lang', '--mode', '--fixture', '--interval'].includes(name)) {
      return { ...out, error: ['optionUnknown', { option: arg }] };
    }
    const value = inline ?? argv[++i];
    if (value === undefined) return { ...out, error: ['valueMissing', { option: name }] };
    if (name === '--lang') {
      if (value !== 'en' && value !== 'ko') return { ...out, error: ['langInvalid', {}] };
      out.lang = value;
    } else if (name === '--mode') {
      if (!MODES.includes(value)) return { ...out, error: ['modeInvalid', {}] };
      out.mode = value;
    } else if (name === '--interval') {
      const n = Number(value);
      if (value.trim() === '' || !Number.isFinite(n) || n < 0) return { ...out, error: ['intervalInvalid', {}] };
      out.interval = n;
    } else {
      out.fixture = value;
    }
  }
  return out;
}

function listFixtures() {
  return readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

/** Run the example. Returns the process exit code (0 ok, 2 usage error). */
export async function main(argv, env = process.env, write = (line) => console.log(line)) {
  const args = parseArgs(argv);
  const lang = resolveLang(args.lang, env);
  const text = MESSAGES[lang];
  const fail = (key, values = {}) => {
    console.error(`error: ${fill(text[key], values)}`);
    return 2;
  };
  if (args.error) return fail(args.error[0], args.error[1]);
  if (args.help) {
    write(text.usage);
    return 0;
  }

  const fixtureName = args.fixture ?? (lang === 'ko' ? 'ko-basic' : 'en-basic');
  const available = listFixtures();
  if (!available.includes(fixtureName)) {
    return fail('fixtureUnknown', { fixture: fixtureName, available: available.join(', ') });
  }
  if (!existsSync(join(distDir, 'index.js'))) return fail('distMissing');

  const { createStreamAnnouncer } = await import(pathToFileURL(join(distDir, 'index.js')).href);
  const { replay, memorySink } = await import(pathToFileURL(join(distDir, 'testing', 'index.js')).href);
  const fixture = JSON.parse(readFileSync(join(fixturesDir, `${fixtureName}.json`), 'utf8'));

  write(fill(text.header, { fixture: fixtureName, mode: args.mode }));
  write(text.heard);
  // The sink prints instead of writing to a live region, so no DOM is needed here.
  const memory = memorySink();
  const announcer = createStreamAnnouncer({
    mode: args.mode,
    locale: lang,
    sink: (message, meta) => {
      memory(message, meta);
      write(`  [${meta.kind}] ${message}`);
    },
  });
  await replay(announcer, fixture.chunks, { intervalMs: args.interval });
  announcer.destroy();
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}

