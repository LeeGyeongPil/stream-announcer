import { describe, expect, it } from 'vitest';
import { MarkdownGuard, createStreamAnnouncer, messages, stripInlineMarkdown } from '../src/index.js';
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
