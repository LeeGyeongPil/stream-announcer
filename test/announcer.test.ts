import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveRegion, createStreamAnnouncer } from '../src/index.js';
import { memorySink, recordLiveRegion, replay } from '../src/testing/index.js';
import { EN_CHUNKS, EN_SENTENCE_HISTORY, burst } from './fixtures.js';

describe('createStreamAnnouncer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sentence mode announces sentences in order', async () => {
    const sink = memorySink();
    await replay(createStreamAnnouncer({ mode: 'sentence', sink }), EN_CHUNKS);
    expect(sink.history).toEqual(EN_SENTENCE_HISTORY);
  });

  it('on-complete mode: heartbeat every 5 s, then one completion with the body', () => {
    const sink = memorySink();
    const a = createStreamAnnouncer({ mode: 'on-complete', sink });
    a.start();
    EN_CHUNKS.forEach((c) => a.push(c));
    vi.advanceTimersByTime(11000);
    expect(sink.history).toEqual(['Generating response.', 'Still generating.', 'Still generating.']);
    a.done();
    expect(sink.history).toHaveLength(4);
    expect(sink.history[3]).toBe(
      'Response complete. Sure! Pi is about 3.14 for most uses. Here is code: python code block, 2 lines. That prints it. Done',
    );
    vi.advanceTimersByTime(20000);
    expect(sink.history).toHaveLength(4);
  });

  it('includeBodyOnComplete: false announces only the completion', async () => {
    const sink = memorySink();
    await replay(createStreamAnnouncer({ sink, includeBodyOnComplete: false }), EN_CHUNKS);
    expect(sink.history).toEqual(['Generating response.', 'Response complete.']);
  });

  it('off mode announces only start and completion, without heartbeat', async () => {
    const sink = memorySink();
    const a = createStreamAnnouncer({ mode: 'off', sink });
    a.start();
    EN_CHUNKS.forEach((c) => a.push(c));
    vi.advanceTimersByTime(30000);
    a.done();
    expect(sink.history).toEqual(['Generating response.', 'Response complete.']);
  });

  it('sentence mode heartbeat only fires after silence', () => {
    const sink = memorySink();
    const a = createStreamAnnouncer({ mode: 'sentence', sink, heartbeatMs: 5000, idleFlushMs: 0 });
    a.start();
    vi.advanceTimersByTime(4000);
    a.push('First sentence. Second');
    expect(sink.history).toEqual(['Generating response.', 'First sentence.']);
    vi.advanceTimersByTime(4000);
    expect(sink.history).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(sink.history.at(-1)).toBe('Still generating.');
    a.destroy();
  });

  it('heartbeatMs: 0 disables the heartbeat', () => {
    const sink = memorySink();
    const a = createStreamAnnouncer({ sink, heartbeatMs: 0 });
    a.start();
    vi.advanceTimersByTime(60000);
    expect(sink.history).toEqual(['Generating response.']);
  });

  it('abort announces once, stops the heartbeat and ignores later input', () => {
    const sink = memorySink();
    const a = createStreamAnnouncer({ sink });
    a.start();
    a.push('Hello there. ');
    a.abort();
    a.abort();
    a.push('More. ');
    a.done();
    vi.advanceTimersByTime(30000);
    expect(sink.history).toEqual(['Generating response.', 'Response stopped.']);
    expect(a.status).toBe('aborted');
  });

  it('error announces once and ignores later input', () => {
    const sink = memorySink();
    const a = createStreamAnnouncer({ sink });
    a.start();
    a.error(new Error('boom'));
    a.error();
    a.push('late');
    vi.advanceTimersByTime(30000);
    expect(sink.history).toEqual(['Generating response.', 'Response failed.']);
    expect(a.status).toBe('error');
  });

  it('start while generating discards the previous response silently', () => {
    const sink = memorySink();
    const a = createStreamAnnouncer({ sink });
    a.start();
    a.push('Old text. More');
    a.start();
    a.push('New text. ');
    a.done();
    expect(sink.history).toEqual(['Generating response.', 'Generating response.', 'Response complete. New text.']);
  });

  it('reasoning and tool events are silent by default and opt-in otherwise', () => {
    const quiet = memorySink();
    const a = createStreamAnnouncer({ sink: quiet });
    a.start();
    a.event({ type: 'reasoning' });
    a.event({ type: 'tool-call', name: 'web_search' });
    expect(quiet.history).toEqual(['Generating response.']);

    const loud = memorySink();
    const b = createStreamAnnouncer({ sink: loud, announceTools: true, announceReasoning: true });
    b.start();
    b.event({ type: 'reasoning' });
    b.event({ type: 'reasoning' });
    b.event({ type: 'tool-call', name: 'web_search' });
    expect(loud.history).toEqual(['Generating response.', 'Thinking.', 'Using tool web_search.']);
    expect(loud.entries.map((e) => e.kind)).toEqual(['start', 'event', 'event']);
  });

  it('announces in Korean and honors message overrides', async () => {
    const sink = memorySink();
    await replay(
      createStreamAnnouncer({ sink, locale: 'ko-KR', messages: { complete: '끝났습니다.' }, includeBodyOnComplete: false }),
      ['안녕하세요. 반갑습니다. '],
    );
    expect(sink.history).toEqual(['응답을 생성하는 중입니다.', '끝났습니다.']);
  });

  it('sentence mode flushes unpunctuated text after the idle time', () => {
    const sink = memorySink();
    const a = createStreamAnnouncer({ mode: 'sentence', sink, locale: 'ko', heartbeatMs: 0 });
    a.start();
    a.push('안녕하세요 반갑습니다');
    vi.advanceTimersByTime(1499);
    expect(sink.history).toEqual(['응답을 생성하는 중입니다.']);
    vi.advanceTimersByTime(1);
    expect(sink.history.at(-1)).toBe('안녕하세요 반갑습니다');
  });

  it('validates options with fix-it messages', () => {
    expect(() => createStreamAnnouncer({ mode: 'loud' as never, sink: memorySink() })).toThrow(/Use one of/);
    expect(() => createStreamAnnouncer({ heartbeatMs: -1, sink: memorySink() })).toThrow(/heartbeatMs/);
    const a = createStreamAnnouncer({ sink: memorySink() });
    a.start();
    expect(() => a.push(42 as never)).toThrow(/expects a string/);
  });

  it('push and done are ignored before start', () => {
    const sink = memorySink();
    const a = createStreamAnnouncer({ sink });
    a.push('text');
    a.done();
    expect(sink.history).toEqual([]);
    expect(a.status).toBe('idle');
  });
});

describe('waiting texts when a response ends early or restarts (default live region)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  function setup(options: Parameters<typeof createStreamAnnouncer>[0] = {}) {
    const a = createStreamAnnouncer({ mode: 'sentence', heartbeatMs: 0, ...options });
    const element = document.querySelector<HTMLElement>('[data-stream-announcer]')!;
    const recorder = recordLiveRegion(element);
    return { a, recorder };
  }

  const oldSentences = (texts: string[]) => texts.filter((t) => t.startsWith('Old '));

  it('abort(): no old sentence is written after the call, "Response stopped." follows within one turn', () => {
    const { a, recorder } = setup();
    a.start();
    a.push(burst('Old', 20));
    vi.advanceTimersByTime(300); // two old sentences get their turn
    const before = recorder.texts();
    expect(oldSentences(before)).toEqual(['Old 1 is here.', 'Old 2 is here.']);
    a.abort();
    vi.advanceTimersByTime(150);
    expect(recorder.texts()).toEqual([...before, 'Response stopped.']);
    vi.advanceTimersByTime(10000);
    expect(recorder.texts()).toEqual([...before, 'Response stopped.']);
    expect(vi.getTimerCount()).toBe(0);
    a.destroy();
  });

  it('abort() right after a burst: only the start text and "Response stopped."', () => {
    const { a, recorder } = setup();
    a.start();
    a.push(burst('Old', 20));
    a.abort();
    vi.advanceTimersByTime(10000);
    expect(recorder.texts()).toEqual(['Generating response.', 'Response stopped.']);
    a.destroy();
  });

  it('error(): no old sentence after the call, then "Response failed."', () => {
    const { a, recorder } = setup();
    a.start();
    a.push(burst('Old', 4));
    vi.advanceTimersByTime(150);
    const before = recorder.texts();
    a.error(new Error('network'));
    vi.advanceTimersByTime(10000);
    expect(recorder.texts()).toEqual([...before, 'Response failed.']);
    expect(oldSentences(recorder.texts())).toEqual(['Old 1 is here.']);
  });

  it('start() again: the previous response is never read after the new one starts', () => {
    const { a, recorder } = setup();
    a.start();
    a.push(burst('Old', 10));
    a.start();
    a.push('New answer begins. ');
    a.done();
    vi.advanceTimersByTime(10000);
    expect(recorder.texts()).toEqual([
      'Generating response.',
      'Generating response.',
      'New answer begins.',
      'Response complete.',
    ]);
    expect(oldSentences(recorder.texts())).toEqual([]);
  });

  it('start() after done(): the old completion still waiting is dropped', () => {
    const { a, recorder } = setup();
    a.start();
    a.push(burst('Old', 5));
    a.done();
    a.start();
    vi.advanceTimersByTime(10000);
    expect(recorder.texts()).toEqual(['Generating response.', 'Generating response.']);
  });

  it('done(): queued sentences are all read, in order, before the completion (regression)', () => {
    const { a, recorder } = setup();
    a.start();
    a.push(burst('Old', 6));
    a.done();
    vi.advanceTimersByTime(10000);
    expect(recorder.texts()).toEqual([
      'Generating response.',
      ...Array.from({ length: 6 }, (_, i) => `Old ${i + 1} is here.`),
      'Response complete.',
    ]);
  });

  it('a shared region: one announcer\'s abort() keeps the other announcer\'s texts', () => {
    const region = createLiveRegion();
    const recorder = recordLiveRegion(region.element);
    const first = createStreamAnnouncer({ mode: 'sentence', heartbeatMs: 0, region });
    const second = createStreamAnnouncer({ mode: 'sentence', heartbeatMs: 0, region });
    expect(document.querySelectorAll('[aria-live]').length).toBe(1);
    first.start();
    second.start();
    first.push(burst('Old', 3));
    second.push('Other one. Other two. ');
    first.abort();
    second.done();
    vi.advanceTimersByTime(10000);
    const texts = recorder.texts();
    expect(oldSentences(texts)).toEqual([]);
    expect(texts.filter((t) => t.startsWith('Other '))).toEqual(['Other one.', 'Other two.']);
    expect(texts.indexOf('Response stopped.')).toBeGreaterThan(0);
    expect(texts.at(-1)).toBe('Response complete.');
    // Destroying an announcer drops only its waiting texts and leaves the shared region in place.
    second.start();
    second.push(burst('Old', 3));
    first.start();
    second.destroy();
    vi.advanceTimersByTime(10000);
    expect(oldSentences(recorder.texts())).toEqual([]);
    expect(recorder.texts().at(-1)).toBe('Generating response.');
    expect(document.querySelectorAll('[aria-live]').length).toBe(1);
    first.destroy();
    expect(document.querySelectorAll('[aria-live]').length).toBe(1);
    region.destroy();
  });

  it('rejects sink and region together', () => {
    const region = createLiveRegion();
    expect(() => createStreamAnnouncer({ sink: memorySink(), region })).toThrow(/either `sink` or `region`/);
    region.destroy();
  });

  it('custom sinks get start/abort/error kinds so they can drop their own queue', () => {
    const sink = memorySink();
    const a = createStreamAnnouncer({ mode: 'sentence', heartbeatMs: 0, sink });
    a.start();
    a.push(burst('Old', 2));
    a.abort();
    expect(sink.entries.map((e) => e.kind)).toEqual(['start', 'sentence', 'abort']); // the last sentence is still held by the buffer
  });
});
