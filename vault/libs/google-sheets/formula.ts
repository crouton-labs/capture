import { FORMAT_CELL_OP } from './constants';
import { Validation, ContractDrift } from '@vallum/_runtime';

type SaveCommand = [number, string];

// Wire-format type tags (token_list entries).
const TOK_ROOT = 1;
const TOK_CALL = 2;
const TOK_LITERAL = 3;
const TOK_REF = 4;

// Inner literal value tags.
const LIT_STRING = 2;
const LIT_NUMBER = 3;
const LIT_BOOL = 4;

// Display piece tags.
const DISP_TEXT = 2;
const DISP_REF = 3;
const DISP_LIT = 5;
const DISP_ARG_SEP = 6;

// Mask for fully-relative refs: row/col stored as deltas from the formula cell.
// Absolute-ref ($) masks haven't been reverse-engineered yet.
const MASK_RELATIVE = 1118464;

// Property tuple opcode for formula cell writes (distinct from LEGACY_STRING
// variant used for plain text).
const FORMULA_PROPERTY_OP = 132274225;

// --- Lexer ---

type Token =
  | { kind: 'EQ'; idx: number }
  | { kind: 'NUM'; idx: number; value: number; text: string }
  | { kind: 'STR'; idx: number; value: string }
  | { kind: 'BOOL'; idx: number; value: boolean }
  | { kind: 'IDENT'; idx: number; name: string }
  | {
      kind: 'REF';
      idx: number;
      raw: string;
      rowStart: number;
      rowEnd: number;
      colStart: number;
      colEnd: number;
    }
  | { kind: 'LP'; idx: number }
  | { kind: 'RP'; idx: number }
  | { kind: 'COMMA'; idx: number }
  | { kind: 'OP'; idx: number; op: string };

function parseA1(s: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(s);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { row: parseInt(m[2], 10) - 1, col: col - 1 };
}

function tokenize(src: string): Token[] {
  if (!src.startsWith('=')) {
    throw new Validation('Formula must start with "="');
  }
  const out: Token[] = [{ kind: 'EQ', idx: 0 }];
  let i = 1;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const idx = out.length;
    if (ch === '"') {
      let j = i + 1;
      let value = '';
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          break;
        }
        value += src[j++];
      }
      if (j >= src.length) {
        throw new Validation(`Unterminated string literal at position ${i}`);
      }
      out.push({ kind: 'STR', idx, value });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const text = src.slice(i, j);
      out.push({ kind: 'NUM', idx, value: parseFloat(text), text });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      const name = src.slice(i, j);
      i = j;
      const upper = name.toUpperCase();
      if (upper === 'TRUE') {
        out.push({ kind: 'BOOL', idx, value: true });
        continue;
      }
      if (upper === 'FALSE') {
        out.push({ kind: 'BOOL', idx, value: false });
        continue;
      }
      const startRef = parseA1(name);
      if (startRef && i < src.length && src[i] === ':') {
        let k = i + 1;
        while (k < src.length && /[A-Za-z0-9]/.test(src[k])) k++;
        const endName = src.slice(i + 1, k);
        const endRef = parseA1(endName);
        if (!endRef) {
          throw new Validation(`Invalid range reference: "${name}:${endName}"`);
        }
        i = k;
        out.push({
          kind: 'REF',
          idx,
          raw: `${name}:${endName}`,
          rowStart: Math.min(startRef.row, endRef.row),
          rowEnd: Math.max(startRef.row, endRef.row) + 1,
          colStart: Math.min(startRef.col, endRef.col),
          colEnd: Math.max(startRef.col, endRef.col) + 1,
        });
        continue;
      }
      if (startRef) {
        out.push({
          kind: 'REF',
          idx,
          raw: name,
          rowStart: startRef.row,
          rowEnd: startRef.row + 1,
          colStart: startRef.col,
          colEnd: startRef.col + 1,
        });
        continue;
      }
      out.push({ kind: 'IDENT', idx, name });
      continue;
    }
    if (ch === '(') {
      out.push({ kind: 'LP', idx });
      i++;
      continue;
    }
    if (ch === ')') {
      out.push({ kind: 'RP', idx });
      i++;
      continue;
    }
    if (ch === ',') {
      out.push({ kind: 'COMMA', idx });
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<>' || two === '<=' || two === '>=') {
      out.push({ kind: 'OP', idx, op: two });
      i += 2;
      continue;
    }
    if ('+-*/^&=<>%'.includes(ch)) {
      out.push({ kind: 'OP', idx, op: ch });
      i++;
      continue;
    }
    if (ch === '$' || ch === '!' || ch === "'") {
      throw new Validation(
        `Unsupported formula syntax near position ${i}: "${ch}" ` +
          '(absolute refs, cross-sheet refs, and quoted sheet names are not yet supported)',
      );
    }
    throw new Validation(`Unexpected character at position ${i}: "${ch}"`);
  }
  return out;
}

// --- Parser ---

type OpKind = 'none' | 'prefix' | 'postfix' | 'infix';

type Ast =
  | { kind: 'num'; value: number; text: string }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'ref'; slot: number }
  | { kind: 'call'; name: string; args: Ast[]; isOp: OpKind };

interface Parser {
  toks: Token[];
  pos: number;
}

function peek(p: Parser): Token | null {
  return p.toks[p.pos] ?? null;
}

function eat(p: Parser): Token {
  const t = p.toks[p.pos];
  if (!t) throw new Validation('Unexpected end of formula');
  p.pos++;
  return t;
}

function expect(p: Parser, kind: Token['kind']): Token {
  const t = eat(p);
  if (t.kind !== kind) {
    throw new Validation(`Expected ${kind} but got ${t.kind}`);
  }
  return t;
}

function parseExpr(p: Parser): Ast {
  return parseComp(p);
}

function parseComp(p: Parser): Ast {
  let left = parseConcat(p);
  while (true) {
    const t = peek(p);
    if (t?.kind !== 'OP' || !['=', '<>', '<', '>', '<=', '>='].includes(t.op))
      break;
    eat(p);
    const right = parseConcat(p);
    left = { kind: 'call', name: t.op, args: [left, right], isOp: 'infix' };
  }
  return left;
}

function parseConcat(p: Parser): Ast {
  let left = parseAdd(p);
  while (
    peek(p)?.kind === 'OP' &&
    (peek(p) as Token & { op: string }).op === '&'
  ) {
    eat(p);
    const right = parseAdd(p);
    left = { kind: 'call', name: '&', args: [left, right], isOp: 'infix' };
  }
  return left;
}

function parseAdd(p: Parser): Ast {
  let left = parseMul(p);
  while (true) {
    const t = peek(p);
    if (t?.kind !== 'OP' || (t.op !== '+' && t.op !== '-')) break;
    eat(p);
    const right = parseMul(p);
    left = { kind: 'call', name: t.op, args: [left, right], isOp: 'infix' };
  }
  return left;
}

function parseMul(p: Parser): Ast {
  let left = parsePow(p);
  while (true) {
    const t = peek(p);
    if (t?.kind !== 'OP' || (t.op !== '*' && t.op !== '/')) break;
    eat(p);
    const right = parsePow(p);
    left = { kind: 'call', name: t.op, args: [left, right], isOp: 'infix' };
  }
  return left;
}

function parsePow(p: Parser): Ast {
  let left = parsePercent(p);
  while (
    peek(p)?.kind === 'OP' &&
    (peek(p) as Token & { op: string }).op === '^'
  ) {
    eat(p);
    const right = parsePercent(p);
    left = { kind: 'call', name: '^', args: [left, right], isOp: 'infix' };
  }
  return left;
}

function parsePercent(p: Parser): Ast {
  let left = parseUnary(p);
  while (
    peek(p)?.kind === 'OP' &&
    (peek(p) as Token & { op: string }).op === '%'
  ) {
    eat(p);
    left = { kind: 'call', name: '%', args: [left], isOp: 'postfix' };
  }
  return left;
}

function parseUnary(p: Parser): Ast {
  const t = peek(p);
  if (t?.kind === 'OP' && (t.op === '-' || t.op === '+')) {
    eat(p);
    const operand = parseUnary(p);
    const name = t.op === '-' ? 'UMINUS' : 'UPLUS';
    return { kind: 'call', name, args: [operand], isOp: 'prefix' };
  }
  return parsePrimary(p);
}

function parsePrimary(p: Parser): Ast {
  const t = eat(p);
  if (t.kind === 'NUM') return { kind: 'num', value: t.value, text: t.text };
  if (t.kind === 'STR') return { kind: 'str', value: t.value };
  if (t.kind === 'BOOL') return { kind: 'bool', value: t.value };
  if (t.kind === 'REF') return { kind: 'ref', slot: t.idx };
  if (t.kind === 'LP') {
    const inner = parseExpr(p);
    expect(p, 'RP');
    return inner;
  }
  if (t.kind === 'IDENT') {
    expect(p, 'LP');
    const args: Ast[] = [];
    if (peek(p)?.kind !== 'RP') {
      args.push(parseExpr(p));
      while (peek(p)?.kind === 'COMMA') {
        eat(p);
        args.push(parseExpr(p));
      }
    }
    expect(p, 'RP');
    return { kind: 'call', name: t.name, args, isOp: 'none' };
  }
  throw new Validation(`Unexpected token: ${t.kind}`);
}

function parse(toks: Token[]): Ast {
  if (toks.length < 1 || toks[0].kind !== 'EQ') {
    throw new Validation('Formula must start with "="');
  }
  const p: Parser = { toks, pos: 1 };
  const ast = parseExpr(p);
  if (p.pos !== toks.length) {
    throw new Validation(`Unexpected trailing tokens at position ${p.pos}`);
  }
  return ast;
}

// --- Emitters ---

type WireTuple = unknown;

function litTuple(node: Ast & { kind: 'num' | 'str' | 'bool' }): WireTuple {
  if (node.kind === 'num') return [LIT_NUMBER, null, node.value];
  if (node.kind === 'str') return [LIT_STRING, node.value];
  return [LIT_BOOL, null, null, node.value ? 1 : 0];
}

function emitTokenList(ast: Ast): WireTuple[] {
  const out: WireTuple[] = [];
  const walk = (n: Ast): void => {
    if (n.kind === 'ref') {
      out.push([TOK_REF, null, null, null, null, n.slot]);
      return;
    }
    if (n.kind === 'num' || n.kind === 'str' || n.kind === 'bool') {
      out.push([TOK_LITERAL, null, null, null, litTuple(n)]);
      return;
    }
    for (const a of n.args) walk(a);
    out.push([TOK_CALL, null, n.name, n.args.length]);
  };
  walk(ast);
  out.push([TOK_ROOT, '=']);
  return out;
}

class DisplayBuilder {
  private pieces: WireTuple[] = [];
  private buf = '';

  text(s: string): void {
    this.buf += s;
  }
  private flush(): void {
    if (this.buf.length > 0) {
      this.pieces.push([DISP_TEXT, this.buf]);
      this.buf = '';
    }
  }
  ref(slot: number): void {
    this.flush();
    this.pieces.push([DISP_REF, null, slot]);
  }
  num(value: number): void {
    this.flush();
    this.pieces.push([DISP_LIT, null, null, null, value]);
  }
  sep(): void {
    this.flush();
    this.pieces.push([DISP_ARG_SEP]);
  }
  build(): WireTuple[] {
    this.flush();
    return this.pieces;
  }
}

function needsParens(child: Ast): boolean {
  return child.kind === 'call' && child.isOp !== 'none';
}

function emitDisplayNode(node: Ast, b: DisplayBuilder): void {
  if (node.kind === 'ref') {
    b.ref(node.slot);
    return;
  }
  if (node.kind === 'num') {
    b.num(node.value);
    return;
  }
  if (node.kind === 'str') {
    b.text(`"${node.value.replace(/"/g, '""')}"`);
    return;
  }
  if (node.kind === 'bool') {
    b.text(node.value ? 'TRUE' : 'FALSE');
    return;
  }
  if (node.isOp === 'infix') {
    const [l, r] = node.args;
    if (needsParens(l)) {
      b.text('(');
      emitDisplayNode(l, b);
      b.text(')');
    } else {
      emitDisplayNode(l, b);
    }
    b.text(node.name);
    if (needsParens(r)) {
      b.text('(');
      emitDisplayNode(r, b);
      b.text(')');
    } else {
      emitDisplayNode(r, b);
    }
    return;
  }
  if (node.isOp === 'prefix') {
    const sym = node.name === 'UMINUS' ? '-' : '+';
    b.text(sym);
    const operand = node.args[0];
    if (needsParens(operand)) {
      b.text('(');
      emitDisplayNode(operand, b);
      b.text(')');
    } else {
      emitDisplayNode(operand, b);
    }
    return;
  }
  if (node.isOp === 'postfix') {
    emitDisplayNode(node.args[0], b);
    b.text(node.name);
    return;
  }
  b.text(`${node.name}(`);
  for (let i = 0; i < node.args.length; i++) {
    if (i > 0) b.sep();
    emitDisplayNode(node.args[i], b);
  }
  b.text(')');
}

function emitDisplay(ast: Ast): WireTuple[] {
  const b = new DisplayBuilder();
  b.text('=');
  emitDisplayNode(ast, b);
  return b.build();
}

function emitRpn(ast: Ast): string {
  let out = '';
  const walk = (n: Ast): void => {
    if (n.kind === 'ref') {
      out += `R${n.slot}]`;
      return;
    }
    if (n.kind === 'num') {
      out += `LD${n.text}]`;
      return;
    }
    if (n.kind === 'str') {
      out += `LS${n.value}]]`;
      return;
    }
    if (n.kind === 'bool') {
      out += `LB${n.value ? 't' : 'f'}]`;
      return;
    }
    for (const a of n.args) walk(a);
    out += `F${n.name}:${n.args.length}]`;
  };
  walk(ast);
  out += 'S';
  return out;
}

// Payload shape derived from HAR captures:
//   [header, propertyTuple, cellData]
//   cellData = [formulas, null, refs]
//   formulas = [formulaHead]
//   formulaHead = [[tokens], [display], rpn]
//   refs = [refsForCell]
//   refsForCell = [refGroup] or []   (empty when the formula has no refs)
//   refGroup = [[tuple, slot], ...]
export function buildFormulaWriteCommand(
  gid: number,
  row: number,
  col: number,
  formula: string,
): SaveCommand {
  const toks = tokenize(formula);
  const refRanges = new Map<number, Token & { kind: 'REF' }>();
  for (const t of toks) {
    if (t.kind === 'REF') refRanges.set(t.idx, t);
  }

  const ast = parse(toks);
  const tokenList = emitTokenList(ast);
  const displayPieces = emitDisplay(ast);
  const rpn = emitRpn(ast);

  const refSlots = new Set<number>();
  const collectSlots = (n: Ast): void => {
    if (n.kind === 'ref') refSlots.add(n.slot);
    else if (n.kind === 'call') n.args.forEach(collectSlots);
  };
  collectSlots(ast);
  const refEntries = [...refSlots]
    .sort((a, b) => a - b)
    .map((slot) => {
      const t = refRanges.get(slot);
      if (!t) throw new ContractDrift(`Missing ref range for slot ${slot}`);
      return [
        [
          t.rowStart - row,
          t.rowEnd - row,
          t.colStart - col,
          t.colEnd - col,
          MASK_RELATIVE,
        ],
        slot,
      ];
    });

  const formulaHead = [[tokenList], [displayPieces], rpn];
  const formulas = [formulaHead];
  const refsForCell = refEntries.length === 0 ? [] : [refEntries];
  const refs = [refsForCell];

  const innerCommand = JSON.stringify([
    [String(gid), row, row + 1, col, col + 1],
    [FORMULA_PROPERTY_OP, 12, null, 0, 0],
    [formulas, null, refs],
  ]);
  return [FORMAT_CELL_OP, innerCommand];
}
