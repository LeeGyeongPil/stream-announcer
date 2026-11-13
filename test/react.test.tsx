import { StrictMode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnnounceText, useStreamAnnouncer, type AnnounceTextStatus } from '../src/react/index.js';
import { memorySink, recordLiveRegion, type MemorySink } from '../src/testing/index.js';
import type { StreamAnnouncer } from '../src/index.js';
import { EN_CHUNKS, EN_SENTENCE_HISTORY, burst } from './fixtures.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Chat(props: { onReady: (a: StreamAnnouncer) => void; sink?: MemorySink; mode?: 'sentence' | 'on-complete' }) {
  const announcer = useStreamAnnouncer({ mode: props.mode ?? 'sentence', ...(props.sink ? { sink: props.sink } : {}) });
  props.onReady(announcer);
  return <div>chat</div>;
}

function Text(props: { text: string; status: AnnounceTextStatus; stopped?: boolean; sink: MemorySink }) {
  useAnnounceText({ text: props.text, status: props.status, mode: 'sentence', sink: props.sink, ...(props.stopped ? { stopped: true } : {}) });
  return null;
}

describe('React hooks', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('useStreamAnnouncer announces in order and cleans up on unmount', () => {
    const sink = memorySink();
    let announcer!: StreamAnnouncer;
    const view = render(<Chat sink={sink} onReady={(a) => (announcer = a)} />);
    act(() => {
      announcer.start();
      EN_CHUNKS.forEach((c) => announcer.push(c));
      announcer.done();
    });
    expect(sink.history).toEqual(EN_SENTENCE_HISTORY);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes the live region and stops the heartbeat on unmount', () => {
    let announcer!: StreamAnnouncer;
    const view = render(<Chat mode="on-complete" onReady={(a) => (announcer = a)} />);
    expect(document.querySelectorAll('[aria-live]').length).toBe(1);
    act(() => announcer.start());
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(document.querySelectorAll('[aria-live]').length).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps one region and one start text under StrictMode', () => {
    const sink = memorySink();
    let announcer!: StreamAnnouncer;
    render(
      <StrictMode>
        <Chat mode="on-complete" sink={sink} onReady={(a) => (announcer = a)} />
      </StrictMode>,
    );
    act(() => announcer.start());
    expect(sink.history).toEqual(['Generating response.']);
    cleanup();

    render(
      <StrictMode>
        <Chat mode="on-complete" onReady={(a) => (announcer = a)} />
      </StrictMode>,
    );
    expect(document.querySelectorAll('[aria-live]').length).toBe(1);
  });

  it('returns a stable reference across renders', () => {
    const seen = new Set<StreamAnnouncer>();
    const view = render(<Chat onReady={(a) => seen.add(a)} />);
    view.rerender(<Chat onReady={(a) => seen.add(a)} />);
    expect(seen.size).toBe(1);
  });

  it('useAnnounceText turns accumulating text and status into the same order', () => {
    const sink = memorySink();
    const view = render(<Text text="" status="submitted" sink={sink} />);
    let text = '';
    for (const chunk of EN_CHUNKS) {
      text += chunk;
      view.rerender(<Text text={text} status="streaming" sink={sink} />);
    }
    view.rerender(<Text text={text} status="ready" sink={sink} />);
    expect(sink.history).toEqual(EN_SENTENCE_HISTORY);
  });

  it('useAnnounceText also works under StrictMode', () => {
    const sink = memorySink();
    const view = render(
      <StrictMode>
        <Text text="" status="idle" sink={sink} />
      </StrictMode>,
    );
    view.rerender(
      <StrictMode>
        <Text text="" status="submitted" sink={sink} />
      </StrictMode>,
    );
    view.rerender(
      <StrictMode>
        <Text text="Hello there. Bye now." status="streaming" sink={sink} />
      </StrictMode>,
    );
    view.rerender(
      <StrictMode>
        <Text text="Hello there. Bye now." status="ready" sink={sink} />
      </StrictMode>,
    );
    expect(sink.history).toEqual(['Generating response.', 'Hello there.', 'Bye now.', 'Response complete.']);
  });

  it('useAnnounceText announces stopped and error once', () => {
    const stopped = memorySink();
    const a = render(<Text text="" status="submitted" sink={stopped} />);
    a.rerender(<Text text="Partial answer. More" status="streaming" sink={stopped} />);
    a.rerender(<Text text="Partial answer. More" status="ready" stopped sink={stopped} />);
    expect(stopped.history.at(-1)).toBe('Response stopped.');
    expect(stopped.history.filter((t) => t === 'Response stopped.')).toHaveLength(1);
    a.unmount();

    const failed = memorySink();
    const b = render(<Text text="" status="submitted" sink={failed} />);
    b.rerender(<Text text="Oops. Partial" status="streaming" sink={failed} />);
    b.rerender(<Text text="Oops. Partial" status="error" sink={failed} />);
    expect(failed.history.at(-1)).toBe('Response failed.');
  });

  it('useStreamAnnouncer abort() after a burst: no old sentence reaches the live region afterwards', () => {
    let announcer!: StreamAnnouncer;
    render(<Chat onReady={(a) => (announcer = a)} />);
    const recorder = recordLiveRegion(document.querySelector('[data-stream-announcer]')!);
    act(() => {
      announcer.start();
      announcer.push(burst('Old', 20));
    });
    act(() => void vi.advanceTimersByTime(150));
    const before = recorder.texts();
    act(() => announcer.abort());
    act(() => void vi.advanceTimersByTime(10000));
    expect(recorder.texts()).toEqual([...before, 'Response stopped.']);
    expect(before).toEqual(['Generating response.', 'Old 1 is here.']);
  });

  function RegionText(props: { text: string; status: AnnounceTextStatus; stopped?: boolean }) {
    useAnnounceText({ text: props.text, status: props.status, mode: 'sentence', heartbeatMs: 0, ...(props.stopped ? { stopped: true } : {}) });
    return null;
  }

  it.each([
    ['ready + stopped', { status: 'ready', stopped: true }, 'Response stopped.'],
    ['error', { status: 'error' }, 'Response failed.'],
  ] as const)('useAnnounceText %s: waiting sentences are dropped before the final text', (_name, end, finalText) => {
    const view = render(<RegionText text="" status="idle" />);
    const recorder = recordLiveRegion(document.querySelector('[data-stream-announcer]')!);
    const text = burst('Old', 10);
    view.rerender(<RegionText text="" status="submitted" />);
    view.rerender(<RegionText text={text} status="streaming" />);
    view.rerender(<RegionText text={text} {...end} />);
    act(() => void vi.advanceTimersByTime(10000));
    expect(recorder.texts()).toEqual(['Generating response.', finalText]);
  });

  it('useAnnounceText: a new submission does not read the previous answer after it starts', () => {
    const view = render(<RegionText text="" status="idle" />);
    const recorder = recordLiveRegion(document.querySelector('[data-stream-announcer]')!);
    const old = burst('Old', 10);
    view.rerender(<RegionText text="" status="submitted" />);
    view.rerender(<RegionText text={old} status="streaming" />);
    view.rerender(<RegionText text={old} status="ready" />);
    view.rerender(<RegionText text="" status="submitted" />);
    view.rerender(<RegionText text="New answer begins. Bye." status="streaming" />);
    view.rerender(<RegionText text="New answer begins. Bye." status="ready" />);
    act(() => void vi.advanceTimersByTime(10000));
    const texts = recorder.texts();
    expect(texts.filter((t) => t.startsWith('Old '))).toEqual([]);
    expect(texts).toEqual(['Generating response.', 'Generating response.', 'New answer begins.', 'Bye.', 'Response complete.']);
  });

  it('useAnnounceText ignores a ready status without a running response', () => {
    const sink = memorySink();
    render(<Text text="Old answer." status="ready" sink={sink} />);
    expect(sink.history).toEqual([]);
  });
});
