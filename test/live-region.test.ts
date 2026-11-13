import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveRegion, createStreamAnnouncer } from '../src/index.js';
import { memorySink, recordLiveRegion, replay } from '../src/testing/index.js';
import { EN_CHUNKS, EN_SENTENCE_HISTORY } from './fixtures.js';

describe('live region', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('creates one status region with the right attributes before the first announcement', () => {
    const a = createStreamAnnouncer();
    expect(document.querySelectorAll('[aria-live]').length).toBe(1);
    const region = document.querySelector('[aria-live]')!;
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    a.destroy();
  });

  it('records texts in the same order as the memory sink', async () => {
    const region = createLiveRegion();
    const recorder = recordLiveRegion(region.element);
    const memory = memorySink();
    const a = createStreamAnnouncer({
      mode: 'sentence',
      sink: (text, meta) => {
        memory(text, meta);
        region.announce(text, meta);
      },
    });
    await replay(a, EN_CHUNKS);
    await vi.advanceTimersByTimeAsync(5000);
    expect(recorder.texts()).toEqual(EN_SENTENCE_HISTORY);
    expect(recorder.texts()).toEqual(memory.history);
    recorder.stop();
    a.destroy();
    region.destroy();
  });

  it('writes the same text twice by clearing and re-writing after the hold and 100 ms', () => {
    const region = createLiveRegion();
    const recorder = recordLiveRegion(region.element);
    region.announce('Still generating.', { kind: 'heartbeat' });
    region.announce('Still generating.', { kind: 'heartbeat' });
    vi.advanceTimersByTime(249);
    expect(recorder.texts()).toEqual(['Still generating.']);
    expect(region.element.textContent).toBe('');
    vi.advanceTimersByTime(1);
    expect(recorder.texts()).toEqual(['Still generating.', 'Still generating.']);
    region.destroy();
  });

  it('keeps order when several texts queue behind a repeat', () => {
    const region = createLiveRegion();
    const recorder = recordLiveRegion(region.element);
    for (const text of ['A one.', 'A one.', 'B two.']) region.announce(text, { kind: 'sentence' });
    vi.advanceTimersByTime(1000);
    expect(recorder.texts()).toEqual(['A one.', 'A one.', 'B two.']);
    region.destroy();
  });

  it('gives each text of the same tick its own turn instead of overwriting', () => {
    const region = createLiveRegion({ spacingMs: 150 });
    const seenByTime: string[] = [];
    region.announce('One.', { kind: 'sentence' });
    region.announce('Two.', { kind: 'sentence' });
    region.announce('Three.', { kind: 'sentence' });
    seenByTime.push(region.element.textContent ?? '');
    vi.advanceTimersByTime(149);
    seenByTime.push(region.element.textContent ?? '');
    vi.advanceTimersByTime(1);
    seenByTime.push(region.element.textContent ?? '');
    vi.advanceTimersByTime(150);
    seenByTime.push(region.element.textContent ?? '');
    expect(seenByTime).toEqual(['One.', 'One.', 'Two.', 'Three.']);
    region.destroy();
  });

  it('after done(): last sentence, the sentence before a code summary and the completion text all land in order', () => {
    const region = createLiveRegion();
    const recorder = recordLiveRegion(region.element);
    const a = createStreamAnnouncer({
      mode: 'sentence',
      sink: (text, meta) => region.announce(text, meta),
    });
    a.start();
    a.push('Here is code:\n```python\nprint(1)\n```\nThat prints it.');
    a.done();
    // Everything the announcer emitted in this tick is queued, not lost.
    vi.advanceTimersByTime(5000);
    const texts = recorder.texts();
    expect(texts[0]).toBe('Generating response.');
    expect(texts.slice(-3)).toEqual(['python code block, 1 line.', 'That prints it.', 'Response complete.']);
    expect(texts).toContain('Here is code:');
    expect(texts.indexOf('Here is code:')).toBeLessThan(texts.indexOf('python code block, 1 line.'));
    a.destroy();
    region.destroy();
  });

  it('toggles aria-busy on the busy target', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const a = createStreamAnnouncer({ busyTarget: target });
    a.start();
    expect(target.getAttribute('aria-busy')).toBe('true');
    a.done();
    expect(target.hasAttribute('aria-busy')).toBe(false);
    a.start();
    a.abort();
    expect(target.hasAttribute('aria-busy')).toBe(false);
    a.start();
    a.destroy();
    expect(target.hasAttribute('aria-busy')).toBe(false);
  });

  it('destroy removes the region, clears timers and rejects later calls', () => {
    const a = createStreamAnnouncer();
    a.start();
    a.destroy();
    expect(document.querySelectorAll('[aria-live]').length).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => a.push('x')).toThrow(new Error('StreamAnnouncer destroyed'));
    expect(() => a.start()).toThrow('StreamAnnouncer destroyed');
    a.destroy();
  });

  it('region destroy stops a pending repeat write', () => {
    const region = createLiveRegion();
    region.announce('Same.', { kind: 'sentence' });
    region.announce('Same.', { kind: 'sentence' });
    region.destroy();
    expect(vi.getTimerCount()).toBe(0);
    region.announce('after', { kind: 'sentence' });
    expect(document.querySelectorAll('[aria-live]').length).toBe(0);
  });

  it('does not create a region when a custom sink is given', () => {
    createStreamAnnouncer({ sink: memorySink() });
    expect(document.querySelectorAll('[aria-live]').length).toBe(0);
  });

  it('clear() drops waiting texts but keeps the written one and the region', () => {
    const region = createLiveRegion();
    const recorder = recordLiveRegion(region.element);
    for (const text of ['One.', 'Two.', 'Three.', 'Four.']) region.announce(text, { kind: 'sentence' });
    region.clear();
    region.announce('Stopped.', { kind: 'abort' });
    // The written text keeps its 150 ms turn, then the new text follows at once.
    vi.advanceTimersByTime(149);
    expect(recorder.texts()).toEqual(['One.']);
    vi.advanceTimersByTime(1);
    expect(recorder.texts()).toEqual(['One.', 'Stopped.']);
    vi.advanceTimersByTime(5000);
    expect(recorder.texts()).toEqual(['One.', 'Stopped.']);
    expect(document.querySelectorAll('[aria-live]').length).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    region.destroy();
  });

  it('clear() cancels a repeated text that waits to be re-written', () => {
    const region = createLiveRegion();
    const recorder = recordLiveRegion(region.element);
    region.announce('Same.', { kind: 'sentence' });
    region.announce('Same.', { kind: 'sentence' });
    vi.advanceTimersByTime(150);
    // The region was emptied and a re-write timer is pending.
    expect(region.element.textContent).toBe('');
    expect(vi.getTimerCount()).toBe(1);
    region.clear();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(recorder.texts()).toEqual(['Same.']);
    region.announce('Next.', { kind: 'sentence' });
    expect(recorder.texts()).toEqual(['Same.', 'Next.']);
    region.destroy();
  });

  it('clear(owner) drops only that owner\'s waiting texts', () => {
    const region = createLiveRegion();
    const recorder = recordLiveRegion(region.element);
    const a = {};
    const b = {};
    region.announce('A first.', { kind: 'sentence', owner: a });
    region.announce('B one.', { kind: 'sentence', owner: b });
    region.announce('A two.', { kind: 'sentence', owner: a });
    region.announce('B two.', { kind: 'sentence', owner: b });
    region.announce('No owner.', { kind: 'sentence' });
    region.clear(a);
    vi.advanceTimersByTime(5000);
    expect(recorder.texts()).toEqual(['A first.', 'B one.', 'B two.', 'No owner.']);
    region.destroy();
  });

  it('clear() after destroy is a no-op', () => {
    const region = createLiveRegion();
    region.destroy();
    expect(() => region.clear()).not.toThrow();
  });

  it('supports assertive politeness', () => {
    const region = createLiveRegion({ politeness: 'assertive' });
    expect(region.element.getAttribute('aria-live')).toBe('assertive');
    region.destroy();
  });
});
