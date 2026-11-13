import type { AnnounceKind, AnnounceSink, StreamAnnouncer } from '../types.js';

export interface MemoryEntry {
  text: string;
  kind: AnnounceKind;
  /** `Date.now()` when the text was announced (fake timers move it). */
  at: number;
}

export type MemorySink = AnnounceSink & {
  /** Announced texts in order. */
  history: string[];
  entries: MemoryEntry[];
  clear(): void;
};

/** A sink that records everything instead of speaking it. */
export function memorySink(): MemorySink {
  const history: string[] = [];
  const entries: MemoryEntry[] = [];
  const sink: AnnounceSink = (text, meta) => {
    history.push(text);
    entries.push({ text, kind: meta.kind, at: Date.now() });
  };
  return Object.assign(sink, {
    history,
    entries,
    clear: () => {
      history.length = 0;
      entries.length = 0;
    },
  });
}

export interface LiveRegionRecorder {
  /** Texts written to the element so far, in order. Reads pending mutations synchronously. */
  texts(): string[];
  stop(): void;
}

/**
 * Record what is written to a live region element via MutationObserver records.
 * Reading the records one by one avoids the batching trap of checking `textContent` once.
 */
export function recordLiveRegion(element: Element): LiveRegionRecorder {
  const view = element.ownerDocument.defaultView;
  if (!view || typeof view.MutationObserver === 'undefined') {
    throw new Error('recordLiveRegion needs a DOM with MutationObserver (for example jsdom).');
  }
  const seen: string[] = [];
  const collect = (records: MutationRecord[]): void => {
    for (const record of records) {
      if (record.type === 'characterData') {
        const data = record.target.textContent ?? '';
        if (data) seen.push(data);
      }
      record.addedNodes.forEach((node) => {
        const text = node.textContent ?? '';
        if (text) seen.push(text);
      });
    }
  };
  const observer = new view.MutationObserver(collect);
  observer.observe(element, { childList: true, characterData: true, subtree: true });
  return {
    texts() {
      collect(observer.takeRecords());
      return [...seen];
    },
    stop() {
      collect(observer.takeRecords());
      observer.disconnect();
    },
  };
}

export interface ReplayOptions {
  /** Wait between chunks. Default 0 (no waiting). */
  intervalMs?: number;
  /** How the stream ends. Default `done`. */
  end?: 'done' | 'abort' | 'error';
}

/** Feed `chunks` into `announcer` like a stream: start, push each chunk, then end. */
export async function replay(
  announcer: StreamAnnouncer,
  chunks: readonly string[],
  options: ReplayOptions = {},
): Promise<void> {
  const intervalMs = options.intervalMs ?? 0;
  announcer.start();
  for (const chunk of chunks) {
    announcer.push(chunk);
    if (intervalMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  announcer[options.end ?? 'done']();
}

/**
 * The comparison baseline: what a screen reader gets when every chunk is appended
 * straight to an aria-live element. Returns the recorded texts.
 */
export function naiveAnnounce(chunks: readonly string[], options: { document?: Document } = {}): string[] {
  const doc = options.document ?? document;
  const element = doc.createElement('div');
  element.setAttribute('aria-live', 'polite');
  doc.body.appendChild(element);
  const recorder = recordLiveRegion(element);
  for (const chunk of chunks) element.appendChild(doc.createTextNode(chunk));
  const texts = recorder.texts();
  recorder.stop();
  element.remove();
  return texts;
}
