import type { AnnouncerMessages } from './messages.js';
import type { GuardOutput } from './types.js';

/** Remove inline Markdown so the screen reader does not say "asterisk asterisk". */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '$1')
    .replace(/(^|[\s(])\*(?=\S)([^*]+?)(?<=\S)\*(?=[\s).,!?;:]|$)/g, '$1$2')
    .replace(/(^|[\s(])_(?=\S)([^_]+?)(?<=\S)_(?=[\s).,!?;:]|$)/g, '$1$2')
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s]*)(.*)$/;
const TABLE_ROW = /^ {0,3}\|/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function matchOpenFence(line: string): { marker: string; lang: string } | null {
  const m = FENCE_LINE.exec(line);
  const marker = m?.[1];
  if (!m || !marker) return null;
  // CommonMark: the info string of a backtick fence cannot contain backticks.
  if (marker.startsWith('`') && (m[2] ?? '').includes('`')) return null;
  if (marker.startsWith('`') && (m[3] ?? '').includes('`')) return null;
  return { marker, lang: m[2] ?? '' };
}

function isClosingFence(line: string, marker: string): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  const found = m?.[1];
  return found !== undefined && found[0] === marker[0] && found.length >= marker.length;
}

const countCells = (row: string): number => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length;

/**
 * Splits a Markdown stream into prose and summaries.
 * Fenced code and tables are never released as text; each becomes one short summary.
 * Detection works line by line, so a fence or table may be split across chunks anywhere.
 * Indented code blocks are not detected.
 */
export class MarkdownGuard {
  private line = '';
  private passthrough = false;
  private fence: { marker: string; lang: string; lines: number } | null = null;
  private table: string[] = [];

  constructor(private readonly options: { messages: Pick<AnnouncerMessages, 'codeBlock' | 'table'> }) {}

  push(text: string): GuardOutput[] {
    const out: GuardOutput[] = [];
    let rest = text;
    while (rest.length > 0) {
      const nl = rest.indexOf('\n');
      if (nl === -1) {
        this.partial(rest, out);
        break;
      }
      this.partial(rest.slice(0, nl), out);
      this.endLine(out);
      rest = rest.slice(nl + 1);
    }
    return out;
  }

  /** The stream ended: close open fences and tables. */
  flush(): GuardOutput[] {
    const out: GuardOutput[] = [];
    if (this.fence) {
      if (this.line.trim().length > 0) this.fence.lines += 1;
      this.line = '';
      this.closeFence(out);
      return out;
    }
    if (!this.passthrough && this.line.length > 0) {
      if (TABLE_ROW.test(this.line)) {
        this.table.push(this.line);
        this.closeTable(out);
      } else {
        this.closeTable(out);
        out.push({ kind: 'prose', text: this.line });
      }
    } else {
      this.closeTable(out);
    }
    this.line = '';
    this.passthrough = false;
    return out;
  }

  private partial(segment: string, out: GuardOutput[]): void {
    if (this.fence) {
      this.line += segment;
      return;
    }
    if (this.passthrough) {
      out.push({ kind: 'prose', text: segment });
      return;
    }
    this.line += segment;
    // Hold the line while it could still become a fence or a table row; otherwise release it now.
    const holdable =
      /^ {0,3}$/.test(this.line) ||
      /^ {0,3}(`{1,2}|~{1,2})$/.test(this.line) ||
      /^ {0,3}(`{3,}|~{3,})/.test(this.line) ||
      TABLE_ROW.test(this.line);
    if (holdable) return;
    this.closeTable(out);
    out.push({ kind: 'prose', text: this.line });
    this.line = '';
    this.passthrough = true;
  }

  private endLine(out: GuardOutput[]): void {
    const line = this.line;
    this.line = '';
    if (this.passthrough) {
      this.passthrough = false;
      out.push({ kind: 'prose', text: '\n' });
      return;
    }
    if (this.fence) {
      if (isClosingFence(line, this.fence.marker)) this.closeFence(out);
      else this.fence.lines += 1;
      return;
    }
    const open = matchOpenFence(line);
    if (open) {
      this.closeTable(out);
      this.fence = { ...open, lines: 0 };
      return;
    }
    if (TABLE_ROW.test(line)) {
      this.table.push(line);
      return;
    }
    this.closeTable(out);
    out.push({ kind: 'prose', text: `${line}\n` });
  }

  private closeFence(out: GuardOutput[]): void {
    if (!this.fence) return;
    const { lang, lines } = this.fence;
    this.fence = null;
    out.push({ kind: 'summary', text: this.options.messages.codeBlock({ lang, lines }) });
  }

  private closeTable(out: GuardOutput[]): void {
    const rows = this.table;
    this.table = [];
    if (rows.length === 0) return;
    const header = rows[0] ?? '';
    const separator = rows[1];
    if (rows.length >= 2 && separator !== undefined && TABLE_SEPARATOR.test(separator)) {
      out.push({
        kind: 'summary',
        text: this.options.messages.table({ columns: countCells(header), rows: rows.length - 2 }),
      });
    } else {
      for (const row of rows) out.push({ kind: 'prose', text: `${row}\n` });
    }
  }
}
