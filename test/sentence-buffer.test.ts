import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SentenceBuffer } from '../src/index.js';
import { EN_CHUNKS, KO_CHUNKS } from './fixtures.js';

function run(buffer: SentenceBuffer, chunks: string[]): string[] {
  const out: string[] = [];
  for (const chunk of chunks) out.push(...buffer.push(chunk));
  out.push(...buffer.flush());
  return out;
}

describe('SentenceBuffer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps 3.14 whole and never emits a lone "3."', () => {
    const out = run(new SentenceBuffer(), ['Sure! Pi is ab', 'out 3.', '14 for most uses. ', 'Next one here.']);
    expect(out).toEqual(['Sure!', 'Pi is about 3.14 for most uses.', 'Next one here.']);
    expect(out).not.toContain('3.');
  });

  it('splits the Korean fixture into exactly four sentences', () => {
    expect(run(new SentenceBuffer({ locale: 'ko' }), KO_CHUNKS)).toEqual([
      '네, 알겠습니다.',
      '파이는 약 3.14입니다.',
      '다음 단계는 무엇인가요?',
      '끝',
    ]);
  });

  it('holds the last segment until more text or flush', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.push('Hello there. ')).toEqual([]);
    expect(buffer.pending).toBe('Hello there. ');
    expect(buffer.flush()).toEqual(['Hello there.']);
    expect(buffer.pending).toBe('');
  });

  it('merges short period fragments into the next sentence', () => {
    expect(run(new SentenceBuffer(), ['Dr. Smith said hi. '])).toEqual(['Dr. Smith said hi.']);
    expect(run(new SentenceBuffer(), ['1. First item\n2. Second item\n'])).toEqual(['1. First item', '2. Second item']);
  });

  it('keeps order: a held fragment is never overtaken by a later sentence', () => {
    // "Dr." is held; the complete sentence after it must not come out first.
    const out = run(new SentenceBuffer(), ['Dr. ', 'Smith said hi. ', 'Bye now. ']);
    expect(out).toEqual(['Dr. Smith said hi.', 'Bye now.']);
  });

  it('flushes unpunctuated text after idleFlushMs (1500)', () => {
    const idle: string[][] = [];
    const buffer = new SentenceBuffer({ locale: 'ko', onIdle: (s) => idle.push(s) });
    buffer.push('안녕하세요 반갑습니다 오늘은 날씨가 좋네요');
    vi.advanceTimersByTime(1499);
    expect(idle).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(idle).toEqual([['안녕하세요 반갑습니다 오늘은 날씨가 좋네요']]);
  });

  it('nextLineStarted releases a line that ended, like the first character of the next line would', () => {
    const idle: string[][] = [];
    const buffer = new SentenceBuffer({ onIdle: (s) => idle.push(s) });
    expect(buffer.push('- item one\n')).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);
    expect(buffer.nextLineStarted()).toEqual(['- item one']);
    // The idle timer stops: the caller that holds the next line flushes when the stream goes quiet.
    expect(vi.getTimerCount()).toBe(0);
    // A short line is still merged with the next one, and text without a line break may still grow.
    const short = new SentenceBuffer();
    short.push('Hi\n');
    expect(short.nextLineStarted()).toEqual([]);
    expect(run(short, ['There you go.'])).toEqual(['Hi There you go.']);
    const open = new SentenceBuffer();
    open.push('Pi is 3.');
    expect(open.nextLineStarted()).toEqual([]);
    expect(open.pending).toBe('Pi is 3.');
    expect(idle).toEqual([]);
  });

  it('restarts the idle timer on every push and stops it on cancel', () => {
    const idle: string[][] = [];
    const buffer = new SentenceBuffer({ onIdle: (s) => idle.push(s) });
    buffer.push('no punctuation yet');
    vi.advanceTimersByTime(1000);
    buffer.push(' still going');
    vi.advanceTimersByTime(1000);
    expect(idle).toHaveLength(0);
    buffer.cancel();
    vi.advanceTimersByTime(5000);
    expect(idle).toHaveLength(0);
  });

  it('cuts text without punctuation at the last space after maxChars (200)', () => {
    const word = 'word ';
    const out = new SentenceBuffer().push(word.repeat(50));
    expect(out).toHaveLength(1);
    expect(out[0]!.length).toBeLessThanOrEqual(200);
    expect(out[0]!.endsWith('word')).toBe(true);
  });

  it('cuts text without any space at maxChars', () => {
    const out = new SentenceBuffer({ maxChars: 10 }).push('가'.repeat(25));
    expect(out).toEqual(['가'.repeat(10), '가'.repeat(10)]);
  });

  it('the English fixture prose never produces a fragment', () => {
    const out = run(new SentenceBuffer(), EN_CHUNKS.slice(0, 3));
    expect(out).toEqual(['Sure!', 'Pi is about 3.14 for most uses.']);
  });

  it('rejects an invalid maxChars and survives an invalid locale', () => {
    expect(() => new SentenceBuffer({ maxChars: 0 })).toThrow(/maxChars/);
    expect(run(new SentenceBuffer({ locale: 'not a locale!!' }), ['One. Two. '])).toEqual(['One.', 'Two.']);
  });
});
