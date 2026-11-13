import type { AnnounceKind } from './types.js';

export interface LiveRegionOptions {
  /** Document that receives the region. Default `globalThis.document`. */
  document?: Document;
  /** `polite` (default) waits for the user to be idle; `assertive` interrupts. */
  politeness?: 'polite' | 'assertive';
  /** Wait between clearing and re-writing an identical text. Default 100. */
  repeatDelayMs?: number;
  /**
   * Minimum time a text stays in the region before the next queued text replaces it, so that
   * every text gets a chance to be read even when several arrive in the same tick. Default 150.
   */
  spacingMs?: number;
}

/** Second argument of `LiveRegion.announce`. Compatible with `AnnounceMeta`, so `announce` works as a sink. */
export interface LiveRegionMeta {
  kind?: AnnounceKind;
  /**
   * Any object that identifies who queued the text (for example one announcer).
   * `clear(owner)` drops only that owner's waiting texts, so several announcers can share one region.
   */
  owner?: object;
}

export interface LiveRegion {
  /** The visually hidden element that screen readers watch. */
  readonly element: HTMLElement;
  /** Queue a text. Usable directly as an `AnnounceSink`. */
  announce(text: string, meta?: LiveRegionMeta): void;
  /**
   * Drop texts that are still waiting for their turn (the text already written stays).
   * With `owner`, only texts queued with that owner are dropped; without it, all of them.
   * The next text is written at the next free turn.
   */
  clear(owner?: object): void;
  /** Remove the element and cancel pending writes. */
  destroy(): void;
}

interface Pending {
  text: string;
  owner: object | undefined;
}

const HIDDEN_STYLE: Record<string, string> = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: '0',
  border: '0',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
};

/**
 * Create one visually hidden status region and attach it right away.
 * Screen readers only announce changes to regions that already exist, so the element is
 * created before the first text is written. Writes are queued so their order is preserved.
 */
export function createLiveRegion(options: LiveRegionOptions = {}): LiveRegion {
  const doc = options.document ?? (typeof document === 'undefined' ? undefined : document);
  if (!doc) {
    throw new Error(
      'createLiveRegion needs a DOM. Pass { document } (for example from jsdom) or provide a custom `sink`.',
    );
  }
  const repeatDelayMs = options.repeatDelayMs ?? 100;
  const spacingMs = options.spacingMs ?? 150;
  const element = doc.createElement('div');
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', options.politeness ?? 'polite');
  element.setAttribute('aria-atomic', 'true');
  element.setAttribute('data-stream-announcer', '');
  for (const [key, value] of Object.entries(HIDDEN_STYLE)) {
    element.style.setProperty(key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), value);
  }
  (doc.body ?? doc.documentElement).appendChild(element);

  const queue: Pending[] = [];
  let current = '';
  // One timer at a time: either "hold the written text for spacingMs" or "re-write a repeated text".
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Set only while a repeated text waits to be re-written (so clear() can cancel it).
  let rewrite: Pending | null = null;
  let destroyed = false;

  // One text per turn: write it, then hold the region for `spacingMs` before the next turn.
  const hold = (delay: number): void => {
    timer = setTimeout(() => {
      timer = null;
      if (!destroyed) drain();
    }, delay);
  };

  const write = (text: string): void => {
    element.textContent = text;
    current = text;
    hold(spacingMs);
  };

  const drain = (): void => {
    if (timer !== null || queue.length === 0) return;
    const next = queue.shift() as Pending;
    if (next.text === current && current !== '') {
      // Identical text is not re-announced by most screen readers: clear first, write again later.
      element.textContent = '';
      current = '';
      rewrite = next;
      timer = setTimeout(() => {
        timer = null;
        rewrite = null;
        if (!destroyed) write(next.text);
      }, repeatDelayMs);
      return;
    }
    write(next.text);
  };

  const matches = (item: Pending, owner: object | undefined): boolean =>
    owner === undefined || item.owner === owner;

  return {
    element,
    announce: (text, meta) => {
      if (destroyed) return;
      queue.push({ text, owner: meta?.owner });
      drain();
    },
    clear: (owner) => {
      if (destroyed) return;
      // Drop waiting texts in place (filter without replacing the array the closures use).
      let kept = 0;
      for (const item of queue) if (!matches(item, owner)) queue[kept++] = item;
      queue.length = kept;
      // A repeated text that is about to be re-written is also still waiting: cancel it.
      if (rewrite !== null && matches(rewrite, owner)) {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        rewrite = null;
        drain();
      }
      // A running hold timer stays: the text on screen keeps its turn, then the next text follows.
    },
    destroy: () => {
      destroyed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      rewrite = null;
      queue.length = 0;
      element.remove();
    },
  };
}
