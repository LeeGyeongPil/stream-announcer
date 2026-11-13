import { useEffect, useRef, useState } from 'react';
import {
  createLiveRegion,
  createStreamAnnouncer,
  type AnnounceMode,
  type LiveRegion,
  type StreamAnnouncer,
} from '../../src/index.js';
import enBasic from '../../examples/fixtures/en-basic.json';
import koBasic from '../../examples/fixtures/ko-basic.json';
import table from '../../examples/fixtures/table.json';
import { playChunks } from './fake-stream.js';
import { UI, initialLang, saveLang, type Lang, type UiKey } from './i18n.js';

const FIXTURES = {
  'en-basic': { chunks: enBasic.chunks, label: 'fixtureEnBasic' },
  'ko-basic': { chunks: koBasic.chunks, label: 'fixtureKoBasic' },
  table: { chunks: table.chunks, label: 'fixtureTable' },
} as const satisfies Record<string, { chunks: string[]; label: UiKey }>;
type FixtureId = keyof typeof FIXTURES;

const SPEEDS = { fast: 400, slow: 2500 } as const;
type Speed = keyof typeof SPEEDS;

const MODES: readonly AnnounceMode[] = ['on-complete', 'sentence', 'off'];

/** Read one address query value (`?mode=sentence`); undefined when absent or not allowed. */
function fromQuery<T extends string>(name: string, allowed: readonly T[]): T | undefined {
  const value = new URLSearchParams(globalThis.location?.search ?? '').get(name);
  return allowed.find((item) => item === value);
}

/** `?autoplay=1` starts the replay as soon as the page opens (used to capture finished screens). */
function wantsAutoplay(): boolean {
  const value = new URLSearchParams(globalThis.location?.search ?? '').get('autoplay');
  return value === '1' || value === 'true';
}

interface Heard {
  text: string;
  kind: string;
  at: number;
}

export function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [mode, setMode] = useState<AnnounceMode>(() => fromQuery('mode', MODES) ?? 'on-complete');
  const [fixture, setFixture] = useState<FixtureId>(() => fromQuery('fixture', Object.keys(FIXTURES) as FixtureId[]) ?? 'en-basic');
  const [speed, setSpeed] = useState<Speed>(() => fromQuery('speed', Object.keys(SPEEDS) as Speed[]) ?? 'fast');
  const [running, setRunning] = useState(false);
  const [naiveLog, setNaiveLog] = useState<string[]>([]);
  const [libLog, setLibLog] = useState<Heard[]>([]);

  const t = UI[lang];
  const region = useRef<LiveRegion | null>(null);
  const run = useRef<{ cancelled: boolean; announcer: StreamAnnouncer | null }>({ cancelled: false, announcer: null });

  // The demo's own live region: created and destroyed as a pair so StrictMode leaves exactly one.
  useEffect(() => {
    const created = createLiveRegion();
    region.current = created;
    return () => {
      created.destroy();
      region.current = null;
    };
  }, []);

  // Keep the page language attribute in sync so a screen reader picks the right voice.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Stop a running replay when the page goes away.
  useEffect(() => {
    const current = run.current;
    return () => {
      current.cancelled = true;
      current.announcer?.destroy();
    };
  }, []);

  // `?autoplay=1`: replay once on open. The ref keeps StrictMode's double effect from starting two runs.
  const autoplayed = useRef(false);
  useEffect(() => {
    if (autoplayed.current || !wantsAutoplay()) return;
    autoplayed.current = true;
    void replay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeLang(next: Lang) {
    setLang(next);
    saveLang(next);
  }

  async function replay() {
    const session = { cancelled: false, announcer: null as StreamAnnouncer | null };
    run.current.cancelled = true;
    run.current.announcer?.destroy();
    run.current = session;
    setRunning(true);
    setNaiveLog([]);
    setLibLog([]);

    const startedAt = Date.now();
    // Every text the library announces goes to the real region and to the right-hand log.
    const announcer = createStreamAnnouncer({
      mode,
      locale: lang,
      sink: (text, meta) => {
        // A new response, Stop or a failure makes sentences that still wait in the region stale.
        if (meta.kind === 'start' || meta.kind === 'abort' || meta.kind === 'error') region.current?.clear();
        region.current?.announce(text, meta);
        setLibLog((log) => [...log, { text, kind: meta.kind, at: Date.now() - startedAt }]);
      },
    });
    session.announcer = announcer;

    announcer.start();
    const finished = await playChunks(
      FIXTURES[fixture].chunks,
      SPEEDS[speed],
      (chunk) => {
        // Left: what happens when each chunk is written straight to an aria-live element.
        setNaiveLog((log) => [...log, chunk]);
        announcer.push(chunk);
      },
      () => session.cancelled,
    );
    if (session.cancelled) return;
    if (finished) announcer.done();
    announcer.destroy();
    setRunning(false);
  }

  function stop() {
    const session = run.current;
    if (session.cancelled) return;
    session.announcer?.abort();
    session.cancelled = true;
    session.announcer?.destroy();
    setRunning(false);
  }

  return (
    <main>
      <header>
        <h1>{t.title}</h1>
        <p>{t.subtitle}</p>
        <p>
          <strong>{t.mockNotice}</strong>
        </p>
      </header>

      <section aria-label="controls" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', margin: '1rem 0' }}>
        <label>
          {t.language}{' '}
          <select data-testid="lang-select" value={lang} onChange={(e) => changeLang(e.target.value as Lang)}>
            <option value="en">English</option>
            <option value="ko">한국어</option>
          </select>
        </label>
        <label>
          {t.mode}{' '}
          <select data-testid="mode-select" value={mode} onChange={(e) => setMode(e.target.value as AnnounceMode)}>
            <option value="on-complete">{t.modeOnComplete}</option>
            <option value="sentence">{t.modeSentence}</option>
            <option value="off">{t.modeOff}</option>
          </select>
        </label>
        <label>
          {t.fixture}{' '}
          <select data-testid="fixture-select" value={fixture} onChange={(e) => setFixture(e.target.value as FixtureId)}>
            {(Object.keys(FIXTURES) as FixtureId[]).map((id) => (
              <option key={id} value={id}>
                {t[FIXTURES[id].label]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.speed}{' '}
          <select data-testid="speed-select" value={speed} onChange={(e) => setSpeed(e.target.value as Speed)}>
            <option value="fast">{t.speedFast}</option>
            <option value="slow">{t.speedSlow}</option>
          </select>
        </label>
        <button type="button" data-testid="replay" onClick={replay} disabled={running}>
          {running ? t.running : t.replay}
        </button>
        <button type="button" data-testid="stop" onClick={stop} disabled={!running}>
          {t.stop}
        </button>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))', gap: '1rem' }}>
        <section aria-labelledby="naive-title">
          <h2 id="naive-title">{t.naiveTitle}</h2>
          <p>{t.naiveHint}</p>
          <p>{t.count.replace('{n}', String(naiveLog.length))}</p>
          <ol data-testid="naive-log">
            {naiveLog.map((chunk, i) => (
              <li key={i}>
                <code>{JSON.stringify(chunk)}</code>
              </li>
            ))}
          </ol>
          {naiveLog.length === 0 && <p>{t.empty}</p>}
        </section>

        <section aria-labelledby="lib-title">
          <h2 id="lib-title">{t.libTitle}</h2>
          <p>{t.libHint}</p>
          <p>{t.count.replace('{n}', String(libLog.length))}</p>
          <ol data-testid="lib-log">
            {libLog.map((entry, i) => (
              <li key={i}>
                <small>
                  {(entry.at / 1000).toFixed(1)}s [{entry.kind}]
                </small>{' '}
                {entry.text}
              </li>
            ))}
          </ol>
          {libLog.length === 0 && <p>{t.empty}</p>}
        </section>
      </div>
    </main>
  );
}
