export type Lang = 'en' | 'ko';

/** localStorage key that stores the chosen screen language. */
export const LANG_KEY = 'stream-announcer-demo.lang';

/** Every text on the demo page. Both languages must define the same keys. */
export const UI = {
  en: {
    title: 'stream-announcer demo',
    subtitle: 'The same streamed answer, announced to a screen reader in two ways.',
    mockNotice: 'Practice mock: recorded chunk replay, not a real LLM.',
    language: 'Language',
    mode: 'Mode',
    modeOnComplete: 'on-complete (default)',
    modeSentence: 'sentence',
    modeOff: 'off',
    fixture: 'Recorded answer',
    fixtureEnBasic: 'English: prose, number, code',
    fixtureKoBasic: 'Korean: prose, number',
    fixtureTable: 'English: table',
    speed: 'Chunk speed',
    speedFast: 'fast (0.4 s)',
    speedSlow: 'slow (2.5 s, shows the heartbeat)',
    replay: 'Replay',
    stop: 'Stop',
    running: 'Replaying...',
    naiveTitle: 'Naive: every chunk written to aria-live',
    naiveHint: 'Log only. It is not wired to aria-live here, so you do not hear it twice.',
    libTitle: 'stream-announcer',
    libHint: 'Written to one real, visually hidden live region. Turn on a screen reader to listen.',
    empty: 'Nothing yet. Press Replay.',
    count: '{n} items',
  },
  ko: {
    title: 'stream-announcer 데모',
    subtitle: '같은 스트리밍 답변을 화면 낭독기에 두 가지 방식으로 알려 줍니다.',
    mockNotice: '연습용 목: 녹화된 청크를 재생하며 실제 LLM이 아닙니다.',
    language: '언어',
    mode: '모드',
    modeOnComplete: 'on-complete (기본)',
    modeSentence: 'sentence',
    modeOff: 'off',
    fixture: '녹화된 답변',
    fixtureEnBasic: '영어: 문장, 숫자, 코드',
    fixtureKoBasic: '한국어: 문장, 숫자',
    fixtureTable: '영어: 표',
    speed: '청크 속도',
    speedFast: '빠름 (0.4초)',
    speedSlow: '느림 (2.5초, 하트비트 확인)',
    replay: '재생',
    stop: '중지',
    running: '재생 중...',
    naiveTitle: '단순 구현: 청크마다 aria-live 에 기록',
    naiveHint: '기록만 보여 줍니다. 여기서는 aria-live 에 연결하지 않아 두 번 들리지 않습니다.',
    libTitle: 'stream-announcer',
    libHint: '화면에 보이지 않는 실제 live region 하나에 기록합니다. 화면 낭독기를 켜고 들어 보세요.',
    empty: '아직 없습니다. 재생을 누르세요.',
    count: '{n}개',
  },
} as const;

export type UiKey = keyof (typeof UI)['en'];

const isLang = (value: unknown): value is Lang => value === 'en' || value === 'ko';

/** `?lang=ko` > saved choice > navigator.language (first run only: ko* -> Korean, else English). */
export function initialLang(): Lang {
  const fromQuery = new URLSearchParams(globalThis.location?.search ?? '').get('lang');
  if (isLang(fromQuery)) return fromQuery;
  try {
    const saved = globalThis.localStorage?.getItem(LANG_KEY);
    if (isLang(saved)) return saved;
  } catch {
    // Storage can be blocked; fall through to detection.
  }
  return /^ko\b/i.test(globalThis.navigator?.language ?? '') ? 'ko' : 'en';
}

export function saveLang(lang: Lang): void {
  try {
    globalThis.localStorage?.setItem(LANG_KEY, lang);
  } catch {
    // Not persisted when storage is blocked; the choice still applies for this visit.
  }
}
