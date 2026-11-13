import { describe, expect, it } from 'vitest';
import { createStreamAnnouncer } from '../src/index.js';
import { memorySink, naiveAnnounce, replay } from '../src/testing/index.js';
import { EN_CHUNKS } from './fixtures.js';

describe('baseline: announcing raw chunks', () => {
  it('naive per-chunk announcing leaves fragments and raw code in the record', () => {
    const naive = naiveAnnounce(EN_CHUNKS);
    expect(naive).toHaveLength(9);
    expect(naive).toContain('out 3.');
    expect(naive.some((t) => t.includes('import math'))).toBe(true);
  });

  it('stream-announcer has no fragments and no raw code', async () => {
    const sink = memorySink();
    await replay(createStreamAnnouncer({ mode: 'sentence', sink }), EN_CHUNKS);
    expect(sink.history).not.toContain('out 3.');
    expect(sink.history.join('\n')).not.toContain('import math');
    // The last text is the flushed "Done" (no punctuation) followed by the completion text.
    const checked = sink.history.filter((t) => t !== 'Done');
    for (const text of checked) expect(text).toMatch(/[.!?:。！？]$/);
  });
});
