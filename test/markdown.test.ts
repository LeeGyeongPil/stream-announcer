import { describe, expect, it } from 'vitest';
import { MarkdownGuard, createStreamAnnouncer, messages, stripInlineMarkdown } from '../src/index.js';
import { resolveMessages } from '../src/messages.js';
import { EN_CHUNKS, TABLE_CHUNKS } from './fixtures.js';
import { memorySink, replay } from '../src/testing/index.js';

function guardOutputs(locale: 'en' | 'ko', chunks: string[]) {
  const guard = new MarkdownGuard({ messages: messages[locale] });
  const out = chunks.flatMap((c) => guard.push(c));
  return [...out, ...guard.flush()];
}

describe('MarkdownGuard', () => {
  it('summarizes a fence split across chunks (en and ko)', () => {
    const en = guardOutputs('en', EN_CHUNKS).filter((o) => o.kind === 'summary');
    expect(en.map((o) => o.text)).toEqual(['python code block, 2 lines.']);
    const ko = guardOutputs('ko', EN_CHUNKS).filter((o) => o.kind === 'summary');
    expect(ko.map((o) => o.text)).toEqual(['python 코드 블록 2줄.']);
  });

  it('never announces raw code', async () => {
    const sink = memorySink();
    await replay(createStreamAnnouncer({ mode: 'sentence', sink }), EN_CHUNKS);
    const all = sink.history.join(' ');
    expect(all).not.toContain('import math');
    expect(all).not.toContain('print(');
    const prose = guardOutputs('en', EN_CHUNKS).filter((o) => o.kind === 'prose').map((o) => o.text).join('');
    expect(prose).not.toContain('import math');
  });

  it('summarizes an unclosed fence exactly once when the stream ends', () => {
    const out = guardOutputs('en', ['Look:\n```js\nconst a = 1;\nconst b = 2;\nconst c', ' = 3;']);
    expect(out.filter((o) => o.kind === 'summary').map((o) => o.text)).toEqual(['js code block, 3 lines.']);
  });

  it('summarizes the same fence in sentence mode via done()', async () => {
    const sink = memorySink();
    await replay(createStreamAnnouncer({ mode: 'sentence', sink }), ['Look:\n```\nline one\nline two\n']);
    expect(sink.history.filter((t) => t.toLowerCase().includes('code block'))).toEqual(['Code block, 2 lines.']);
  });

  it('closes a fence only with a matching marker of at least the same length', () => {
    const out = guardOutputs('en', ['````md\n```\ninner\n```\nstill code\n````\nafter\n']);
    expect(out.filter((o) => o.kind === 'summary').map((o) => o.text)).toEqual(['md code block, 4 lines.']);
    expect(out.filter((o) => o.kind === 'prose').map((o) => o.text).join('')).toBe('after\n');
  });

  it('keeps backticks inside a sentence as prose', () => {
    const out = guardOutputs('en', ['Use `npm test` and ``double`` ticks.\n']);
    expect(out.every((o) => o.kind === 'prose')).toBe(true);
    expect(out.map((o) => o.text).join('')).toBe('Use `npm test` and ``double`` ticks.\n');
  });

  it('summarizes a table split across chunks (en and ko)', () => {
    const en = guardOutputs('en', TABLE_CHUNKS).filter((o) => o.kind === 'summary');
    expect(en.map((o) => o.text)).toEqual(['Table, 3 columns, 2 rows.']);
    const ko = guardOutputs('ko', TABLE_CHUNKS).filter((o) => o.kind === 'summary');
    expect(ko.map((o) => o.text)).toEqual(['3열 2행 표.']);
  });

  it('treats pipe lines without a separator row as prose', () => {
    const out = guardOutputs('en', ['| just a line |\nnext\n']);
    expect(out.every((o) => o.kind === 'prose')).toBe(true);
  });

  it('closes a table that ends the stream', () => {
    const out = guardOutputs('en', ['| a | b |\n|---|---|\n| 1 | 2 |']);
    expect(out.map((o) => o.text)).toEqual(['Table, 2 columns, 1 row.']);
  });
});

describe('stripInlineMarkdown', () => {
  it('removes emphasis, links and inline code', () => {
    expect(stripInlineMarkdown('That **prints** [it](https://example.com) with `code`.')).toBe(
      'That prints it with code.',
    );
  });

  it('removes headings, list markers and quotes but keeps numbers and snake_case', () => {
    expect(stripInlineMarkdown('## Title')).toBe('Title');
    expect(stripInlineMarkdown('- item')).toBe('item');
    expect(stripInlineMarkdown('> quoted')).toBe('quoted');
    expect(stripInlineMarkdown('1. First item')).toBe('1. First item');
    expect(stripInlineMarkdown('call my_function_name now')).toBe('call my_function_name now');
    expect(stripInlineMarkdown('an *italic* and _under_ word')).toBe('an italic and under word');
  });
});

describe('MarkdownGuard with CRLF line endings', () => {
  const crlf = 'Hi.\r\n```js\r\nx\r\n```\r\nBye.';
  const summaries = (chunks: string[]) => guardOutputs('en', chunks).filter((o) => o.kind === 'summary').map((o) => o.text);

  it('summarizes a fence the same as with LF', () => {
    expect(summaries([crlf])).toEqual(['js code block, 1 line.']);
    expect(summaries([crlf.replace(/\r\n/g, '\n')])).toEqual(['js code block, 1 line.']);
  });

  it('works when CR and LF arrive in different chunks', () => {
    expect(summaries(crlf.split(/(?<=\r)/))).toEqual(['js code block, 1 line.']);
    expect(summaries([...crlf].map((c) => c))).toEqual(['js code block, 1 line.']);
  });

  it('summarizes a table with CRLF', () => {
    expect(summaries(['| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\n'])).toEqual(['Table, 2 columns, 1 row.']);
  });

  it('announces Hi., summary, Bye. through the announcer', async () => {
    const sink = memorySink();
    await replay(createStreamAnnouncer({ mode: 'sentence', sink }), [crlf]);
    expect(sink.history).toEqual([
      'Generating response.',
      'Hi.',
      'js code block, 1 line.',
      'Bye.',
      'Response complete.',
    ]);
  });
});

describe('MarkdownGuard with tables that have no leading pipe', () => {
  const input = 'T:\na | b\n--- | ---\n1 | 2\nEnd.';
  // Adjacent prose pieces are merged: how prose is cut into pieces may depend on the chunks.
  const texts = (chunks: string[]) =>
    guardOutputs('en', chunks).reduce<string[]>((acc, o) => {
      const last = acc.at(-1);
      if (o.kind === 'prose' && last?.startsWith('prose:')) acc[acc.length - 1] = last + o.text;
      else acc.push(`${o.kind}:${o.text}`);
      return acc;
    }, []);
  const joinProse = (chunks: string[]) =>
    guardOutputs('en', chunks).filter((o) => o.kind === 'prose').map((o) => o.text).join('');

  it('summarizes the table through the announcer in sentence mode', async () => {
    const sink = memorySink();
    await replay(createStreamAnnouncer({ mode: 'sentence', sink }), [input]);
    expect(sink.history).toEqual([
      'Generating response.',
      'T:',
      'Table, 2 columns, 1 row.',
      'End.',
      'Response complete.',
    ]);
  });

  it('reads a pipe in ordinary prose verbatim', () => {
    expect(joinProse(['a | b\nnext line\n'])).toBe('a | b\nnext line\n');
    expect(guardOutputs('en', ['a | b\nnext line\n']).some((o) => o.kind === 'summary')).toBe(false);
  });

  it('does not treat a bare --- or a mismatched cell count as a table', () => {
    expect(joinProse(['a | b\n---\n'])).toBe('a | b\n---\n');
    expect(joinProse(['a | b\n--- | --- | ---\n'])).toBe('a | b\n--- | --- | ---\n');
  });

  it('closes the table at a blank line or a line without a pipe', () => {
    const out = texts(['a | b\n--- | ---\n1 | 2\n\nafter\n']);
    expect(out.filter((t) => t.startsWith('summary:'))).toEqual(['summary:Table, 2 columns, 1 row.']);
    expect(joinProse(['a | b\n--- | ---\n1 | 2\n\nafter\n'])).toBe('\nafter\n');
  });

  it('gives the same result for every chunk split, including flush', () => {
    const more = [
      'No. | Name\n--- | ---\n1 | Kim\nLet me check',
      'Hi! | b\n-|-\n1|2',
      '| a | b |\n|---|---|\n| 1 | 2 |\nEnd',
      'Use a | b here.\nLet me check',
      'a | b\n|',
      '今日は晴れ。明日は雨。',
      // The first "|" comes after maxChars (200): prose, wherever the chunks were cut.
      `${'word '.repeat(45)}| y\n--- | ---\n1 | 2`,
    ];
    for (const text of [input, 'a | b\n--- | ---', 'a | b\nplain', ...more]) {
      const whole = texts([text]);
      for (let i = 1; i < text.length; i++) {
        expect(texts([text.slice(0, i), text.slice(i)])).toEqual(whole);
      }
      // One character at a time.
      expect(texts([...text])).toEqual(whole);
    }
  });

  it('recognizes a table when the header is split before its first pipe (token-like chunks)', () => {
    const chunks = ['T:\n', 'Name', ' |', ' Age', '\n', '---', ' | ---\n', 'Kim', ' | 3', '0\n', 'End.'];
    expect(texts(chunks).filter((t) => t.startsWith('summary:'))).toEqual(['summary:Table, 2 columns, 1 row.']);
    expect(texts(chunks)).toEqual(texts([chunks.join('')]));
  });

  it('releases a long line without a pipe once it passes maxChars', () => {
    const out = new MarkdownGuard({ messages: resolveMessages('en'), maxChars: 10 }).push('abcdefghijkl');
    expect(out).toEqual([{ kind: 'prose', text: 'abcdefghijkl' }]);
  });

  it('releasePending frees a held line, and a held header with its separator prefix', () => {
    const g = new MarkdownGuard({ messages: resolveMessages('en') });
    expect(g.push('Name')).toEqual([]);
    expect(g.releasePending()).toEqual([{ kind: 'prose', text: 'Name' }]);
    const h = new MarkdownGuard({ messages: resolveMessages('en') });
    expect(h.push('a | b\n--')).toEqual([]);
    expect(h.releasePending().map((o) => o.text).join('')).toBe('a | b\n--');
    const f = new MarkdownGuard({ messages: resolveMessages('en') });
    f.push('```js\nx');
    expect(f.releasePending()).toEqual([]);
  });

  it('recognizes a header whose first cell ends with a period or "!" ("No. | Name")', () => {
    expect(texts(['No. | Name\n--- | ---\n1 | Kim\n'])).toEqual(['summary:Table, 2 columns, 1 row.']);
    expect(texts(['Hi! | b\n-|-\n1|2\n'])).toEqual(['summary:Table, 2 columns, 1 row.']);
    // Once a sentence ended before any "|" and the next one began, the line is prose at once.
    const guard = () => new MarkdownGuard({ messages: resolveMessages('en') });
    expect(guard().push('Hello. W')).toEqual([{ kind: 'prose', text: 'Hello. W' }]);
    expect(guard().push('晴れ。明')).toEqual([{ kind: 'prose', text: '晴れ。明' }]);
    expect(guard().push('No. ')).toEqual([]);
  });

  it('releasePending reads what waits only for a "|", and keeps fences, "|" rows and open tables waiting', () => {
    const guard = () => new MarkdownGuard({ messages: resolveMessages('en') });
    const summary = { kind: 'summary', text: 'Table, 2 columns, 1 row.' };
    // A "|" table closes at the first character that is not "|", as before. The line after it waits for a "|".
    const piped = guard();
    expect(piped.push('| a | b |\n|---|---|\n| 1 | 2 |\nEnd')).toEqual([summary]);
    expect(piped.releasePending()).toEqual([{ kind: 'prose', text: 'End' }]);
    // A row of a table without leading pipes may start with plain text, so "End" closes it only on release.
    const plain = guard();
    expect(plain.push('a | b\n--- | ---\n1 | 2\nEnd')).toEqual([]);
    expect(plain.releasePending()).toEqual([summary, { kind: 'prose', text: 'End' }]);
    // A possible header with no next line yet.
    const header = guard();
    expect(header.push('Use a | b here.\n')).toEqual([]);
    expect(header.releasePending()).toEqual([{ kind: 'prose', text: 'Use a | b here.\n' }]);
    // Still waiting: a row that has its "|", open tables at a line start, a possible fence.
    for (const text of ['a | b\n--- | ---\n1 | 2\n3 |', 'a | b\n--- | ---\n1 | 2\n', '| a | b |\n|---|---|\n', 'Look:\n``']) {
      const g = guard();
      g.push(text);
      expect(g.releasePending()).toEqual([]);
    }
  });

  it('holdsPossibleTable is true only while a "|" may still make a table without leading pipes', () => {
    const holds = (text: string) => {
      const g = new MarkdownGuard({ messages: resolveMessages('en') });
      g.push(text);
      return g.holdsPossibleTable;
    };
    expect(['Name', 'a | b\n', 'a | b\n--', 'a | b\n--- | ---\n1 | 2\n'].map(holds)).toEqual([true, true, true, true]);
    expect(['Hello. World', 'done\n', '| a |', '``', '```js\nx'].map(holds)).toEqual([false, false, false, false, false]);
  });

  it('closes a table without leading pipes when a line has no "|" within maxChars', () => {
    const g = new MarkdownGuard({ messages: resolveMessages('en'), maxChars: 20 });
    expect(g.push('a | b\n--- | ---\n1 | 2\n')).toEqual([]);
    const long = 'x'.repeat(21);
    expect(g.push(long)).toEqual([{ kind: 'summary', text: 'Table, 2 columns, 1 row.' }, { kind: 'prose', text: long }]);
  });

  it('keeps the stream order when the stream ends right after a possible header', () => {
    expect(joinProse(['a | b\n|'])).toBe('a | b\n|\n');
  });
});

describe('MarkdownGuard closing fence at end of stream', () => {
  const summary = (chunks: string[]) =>
    guardOutputs('en', chunks).filter((o) => o.kind === 'summary').map((o) => o.text);

  it('does not count a closing fence without trailing newline', () => {
    expect(summary(['x:\n```py\nprint(1)\n```'])).toEqual(['py code block, 1 line.']);
  });
  it('keeps 1 line when a trailing newline exists', () => {
    expect(summary(['x:\n```py\nprint(1)\n```\n'])).toEqual(['py code block, 1 line.']);
  });
  it('still counts the last code line of an unclosed fence', () => {
    expect(summary(['x:\n```py\nprint(1)\nprint(2)'])).toEqual(['py code block, 2 lines.']);
  });
  it('handles a closing fence split across chunks', () => {
    expect(summary(['x:\n```py\nprint(1)\n``', '`'])).toEqual(['py code block, 1 line.']);
  });
  it('does not treat shorter or different markers as closing', () => {
    expect(summary(['x:\n````py\nprint(1)\n```'])).toEqual(['py code block, 2 lines.']);
    expect(summary(['x:\n~~~py\nprint(1)\n```'])).toEqual(['py code block, 2 lines.']);
  });
});
