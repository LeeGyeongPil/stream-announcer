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
/** Text that can still grow into a separator row ("--- | :-"). */
const SEPARATOR_START = /^[\s:|-]*$/;
/**
 * A sentence ended and the next one began: "Hello. W", "晴れ。明".
 * "No. | Name" does not match, because only "|" follows the period.
 */
const NEXT_SENTENCE = /(?:[.!?…]["'”’)\]」』]*\s+|[。！？]["'”’)\]」』]*\s*)[^\s|]/;

/**
 * Line starts that always wait for the end of their line, as they did before tables without
 * leading pipes were supported: blanks, (possible) fences and rows that start with "|".
 */
function waitsForLineEnd(line: string): boolean {
  return (
    /^ {0,3}$/.test(line) ||
    /^ {0,3}(`{1,2}|~{1,2})$/.test(line) ||
    /^ {0,3}(`{3,}|~{3,})/.test(line) ||
    TABLE_ROW.test(line)
  );
}

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
 * A line that may still be the header of a table without leading pipes ("a | b") is held until the
 * next line shows whether a separator row follows; `releasePending()` lets it go when the stream goes quiet.
 * Indented code blocks are not detected.
 */
export class MarkdownGuard {
  private line = '';
  private passthrough = false;
  private fence: { marker: string; lang: string; lines: number } | null = null;
  private table: string[] = [];
  /** A complete line without a leading pipe that holds "|": a table header until the next line says otherwise. */
  private candidate: string | null = null;
  /** A trailing "\r" is held back until the next chunk shows whether it starts a "\r\n". */
  private heldCr = false;

  private readonly maxChars: number;

  constructor(private readonly options: { messages: Pick<AnnouncerMessages, 'codeBlock' | 'table'>; maxChars?: number }) {
    this.maxChars = options.maxChars ?? 200;
  }

  /**
   * True while text is held only because a "|" may still make it part of a table without leading
   * pipes (a possible header, the line after it, or the rows of such a table). Fences and rows that
   * start with "|" are not counted: they always wait for the end of their line.
   */
  get holdsPossibleTable(): boolean {
    if (this.fence || this.passthrough) return false;
    if (this.candidate !== null || this.inTableWithoutPipes()) return true;
    return this.line.length > 0 && !waitsForLineEnd(this.line);
  }

  /**
   * The stream went quiet: release what is held only because a "|" might still come, so it can be
   * read now. Fences, rows that start with "|", and a table waiting for its next row keep waiting.
   * After this, the rest of a released line passes through as prose.
   */
  releasePending(): GuardOutput[] {
    const out: GuardOutput[] = [];
    if (this.fence || this.passthrough) return out;
    // A possible header is read as the line it probably is.
    this.releaseCandidate(out);
    const line = this.line;
    if (line.trim().length === 0 || waitsForLineEnd(line)) return out;
    // A row of a table without leading pipes that already has its "|" waits like a "|" row.
    if (this.inTableWithoutPipes() && line.includes('|')) return out;
    this.closeTable(out);
    out.push({ kind: 'prose', text: line });
    this.line = '';
    this.passthrough = true;
    return out;
  }

  push(text: string): GuardOutput[] {
    const out: GuardOutput[] = [];
    // Treat "\r\n" as "\n", even when the "\r" and "\n" arrive in different chunks.
    let rest = (this.heldCr ? '\r' : '') + text;
    this.heldCr = rest.endsWith('\r');
    if (this.heldCr) rest = rest.slice(0, -1);
    rest = rest.replace(/\r\n/g, '\n');
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
    this.heldCr = false;
    if (this.fence) {
      // A closing fence without a final newline is not a code line.
      if (this.line.trim().length > 0 && !isClosingFence(this.line, this.fence.marker)) this.fence.lines += 1;
      this.line = '';
      this.closeFence(out);
      return out;
    }
    const line = this.passthrough ? '' : this.line;
    if (line.length > 0) {
      if (this.candidate !== null && this.isSeparator(line, this.candidate)) {
        // "a | b" + "--- | ---" at the very end: a table without rows.
        this.table = [this.candidate, line];
        this.candidate = null;
      } else {
        // The possible header goes first, so the order stays the same as in the stream.
        this.releaseCandidate(out);
        if (this.isTableLine(line)) {
          this.table.push(line);
        } else {
          this.closeTable(out);
          out.push({ kind: 'prose', text: line });
        }
      }
    }
    this.closeTable(out);
    this.releaseCandidate(out);
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
    const line = this.line;
    // A possible header is released as soon as this line can no longer be its separator row.
    if (this.candidate !== null && !SEPARATOR_START.test(line)) this.releaseCandidate(out);
    // Blanks, fences and "|" rows wait for the end of the line, exactly as before.
    if (waitsForLineEnd(line)) return;
    // A table with leading pipes ends at the first line that is clearly not a "|" row.
    if (!this.inTableWithoutPipes()) this.closeTable(out);
    if (this.mayStillBeTableLine(line)) return;
    this.closeTable(out);
    this.releaseCandidate(out);
    out.push({ kind: 'prose', text: line });
    this.line = '';
    this.passthrough = true;
  }

  /**
   * Whether an unfinished line is worth holding because it may still become a header, separator
   * or row of a table without leading pipes. Once a line is released, every longer version of it
   * would be released too, so where the chunks were cut does not change the result.
   */
  private mayStillBeTableLine(line: string): boolean {
    const firstPipe = line.indexOf('|');
    // No "|" within maxChars: too long to wait for.
    if ((firstPipe === -1 ? line.length : firstPipe) > this.maxChars) return false;
    // A row of a table without leading pipes, or the line after a possible header: wait for the line end.
    if (this.inTableWithoutPipes() || this.candidate !== null) return true;
    // A possible header ("a | b"): prose once a sentence ended before any "|" and the next one began.
    const beforePipe = firstPipe === -1 ? line : line.slice(0, firstPipe);
    return !NEXT_SENTENCE.test(beforePipe);
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
      this.releaseCandidate(out);
      this.fence = { ...open, lines: 0 };
      return;
    }
    if (this.candidate !== null) {
      if (this.isSeparator(line, this.candidate)) {
        this.table = [this.candidate, line];
        this.candidate = null;
        return;
      }
      this.releaseCandidate(out);
    }
    if (this.isTableLine(line)) {
      this.table.push(line);
      return;
    }
    this.closeTable(out);
    // A line with "|" but no leading pipe may be a header: decide when the next line shows its separator.
    if (line.includes('|')) {
      this.candidate = line;
      return;
    }
    out.push({ kind: 'prose', text: `${line}\n` });
  }

  /** A confirmed table whose header has no leading pipe ("a | b"). Its rows may start with text. */
  private inTableWithoutPipes(): boolean {
    const header = this.table[0];
    return header !== undefined && !TABLE_ROW.test(header);
  }

  /** Rows of an open table: "|" rows, or any line with "|" in a table without leading pipes. */
  private isTableLine(line: string): boolean {
    return TABLE_ROW.test(line) || (this.inTableWithoutPipes() && line.includes('|'));
  }

  private isSeparator(line: string, header: string): boolean {
    return line.includes('|') && TABLE_SEPARATOR.test(line) && countCells(line) === countCells(header);
  }

  private releaseCandidate(out: GuardOutput[]): void {
    if (this.candidate === null) return;
    out.push({ kind: 'prose', text: `${this.candidate}\n` });
    this.candidate = null;
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
