// The regular expression panel's logic (pattern rules): explanations of a pattern, hints for the mistakes that
// matter for a validator, and testing sample values the way the `pattern` validator does. Parsed with regexpp, the
// parser ESLint uses, so the syntax is ECMAScript's, as the client runs it.

import { RegExpParser, RegExpSyntaxError, type AST } from '@eslint-community/regexpp';

export type TokenKind = 'anchor' | 'class' | 'set' | 'group' | 'quantifier' | 'literal' | 'alternation' | 'backref' | 'lookaround';

/** A piece of the pattern, for colouring and explaining it. */
export interface RegexToken {
  start: number;
  end: number;
  kind: TokenKind;
  raw: string;
  explanation: string;
}

export interface RegexHint {
  severity: 'warning' | 'info';
  message: string;
  /** A fix the panel can apply: the pattern it suggests. */
  fix?: { label: string; pattern: string };
}

export interface RegexAnalysis {
  /** The pattern without `/.../flags` around it, and the flags that apply. */
  source: string;
  flags: string;
  /** Set when the pattern doesn't parse; `index` is where in `source` the parser stopped. */
  error?: { message: string; index: number };
  tokens: RegexToken[];
  /** What to colour: a group's brackets (not its content), a quantifier's suffix, a class, an anchor, a `|`. */
  highlights: { start: number; end: number; kind: TokenKind }[];
  /** The top-level pieces, explained in order: the pattern read from left to right. */
  steps: RegexToken[];
  hints: RegexHint[];
}

/** `/source/flags` (the pattern written with its own flags) or a plain pattern with `context.flags`. */
export function splitPattern(pattern: string, flags = ''): { source: string; flags: string; literal: boolean } {
  const literal = /^\/(.*)\/([a-z]*)$/s.exec(pattern);
  return literal ? { source: literal[1], flags: literal[2], literal: true } : { source: pattern, flags, literal: false };
}

const ordinal = (n: number) => `${n}`;

function times(q: AST.Quantifier): string {
  const { min, max } = q;
  if (min === 0 && max === Infinity) return 'zero or more times';
  if (min === 1 && max === Infinity) return 'one or more times';
  if (min === 0 && max === 1) return 'optionally';
  if (min === max) return min === 1 ? 'once' : `exactly ${min} times`;
  if (max === Infinity) return `${min} or more times`;
  return `${min} to ${max} times`;
}

function charName(code: number): string {
  const named: Record<number, string> = { 9: 'a tab', 10: 'a line feed', 13: 'a carriage return', 32: 'a space', 0: 'NUL' };
  if (named[code] !== undefined) return named[code];
  const ch = String.fromCodePoint(code);
  return `'${ch}'`;
}

function setName(node: AST.CharacterSet, dotAll: boolean): string {
  switch (node.kind) {
    case 'any':
      return dotAll ? 'any character' : 'any character except a line break';
    case 'digit':
      return node.negate ? 'any character but a digit' : 'a digit (0–9)';
    case 'space':
      return node.negate ? 'any character but whitespace' : 'a whitespace character (space, tab, line break…)';
    case 'word':
      return node.negate ? 'any character but a letter, digit or _' : 'a letter, digit or _ (A–Z, a–z, 0–9, _)';
    case 'property': {
      const property = 'value' in node && node.value ? `${node.key}=${node.value}` : node.key;
      return `${node.negate ? 'any character not in' : 'a character in'} the Unicode property ${property}`;
    }
    default:
      return (node as AST.Node).raw;
  }
}

function classItem(node: AST.CharacterClassElement, dotAll: boolean): string {
  switch (node.type) {
    case 'Character':
      return charName(node.value);
    case 'CharacterClassRange':
      return `${String.fromCodePoint(node.min.value)}–${String.fromCodePoint(node.max.value)}`;
    case 'CharacterSet':
      return setName(node as AST.CharacterSet, dotAll);
    default:
      return node.raw;
  }
}

function describeClass(node: AST.CharacterClass, dotAll: boolean): string {
  const items = node.elements.map((e) => classItem(e, dotAll)).join(', ');
  return node.negate ? `any character except ${items}` : `one of: ${items}`;
}

function describe(node: AST.Node, dotAll: boolean, multiline: boolean): string {
  switch (node.type) {
    case 'Character':
      return charName(node.value);
    case 'CharacterSet':
      return setName(node, dotAll);
    case 'CharacterClass':
      return describeClass(node, dotAll);
    case 'Quantifier': {
      const inner = describe(node.element, dotAll, multiline);
      return `${inner}, ${times(node)}${node.greedy ? '' : ' (as few as possible)'}`;
    }
    case 'Group':
      return `(${describeAlternatives(node.alternatives, dotAll, multiline)})`;
    case 'CapturingGroup':
      return `(group ${node.name ? `'${node.name}'` : ordinal(groupNumber(node))}: ${describeAlternatives(node.alternatives, dotAll, multiline)})`;
    case 'Assertion':
      switch (node.kind) {
        case 'start':
          return multiline ? 'the start of a line' : 'the start of the value';
        case 'end':
          return multiline ? 'the end of a line' : 'the end of the value';
        case 'word':
          return node.negate ? 'a position that is not a word boundary' : 'a word boundary';
        case 'lookahead':
          return `${node.negate ? 'not followed by' : 'followed by'} (${describeAlternatives(node.alternatives, dotAll, multiline)})`;
        case 'lookbehind':
          return `${node.negate ? 'not preceded by' : 'preceded by'} (${describeAlternatives(node.alternatives, dotAll, multiline)})`;
      }
      return (node as AST.Node).raw;
    case 'Backreference':
      return `the same text as group ${typeof node.ref === 'number' ? node.ref : `'${node.ref}'`} matched`;
    default:
      return node.raw;
  }
}

function describeAlternatives(alternatives: AST.Alternative[], dotAll: boolean, multiline: boolean): string {
  const parts = alternatives.map((a) => (a.elements.length ? a.elements.map((e) => describe(e, dotAll, multiline)).join(', then ') : 'nothing'));
  return parts.length > 1 ? `either ${parts.join(', or ')}` : parts[0];
}

let groupCounter = new Map<AST.CapturingGroup, number>();
function groupNumber(node: AST.CapturingGroup): number {
  return groupCounter.get(node) ?? 0;
}

function kindOf(node: AST.Node): TokenKind | undefined {
  switch (node.type) {
    case 'Assertion':
      return node.kind === 'lookahead' || node.kind === 'lookbehind' ? 'lookaround' : 'anchor';
    case 'CharacterClass':
      return 'class';
    case 'CharacterSet':
      return 'set';
    case 'Group':
    case 'CapturingGroup':
      return 'group';
    case 'Quantifier':
      return 'quantifier';
    case 'Character':
      return 'literal';
    case 'Backreference':
      return 'backref';
    default:
      return undefined;
  }
}

/** Parses and explains a pattern. Never throws: a syntax error comes back in `error`. */
export function analyzeRegex(pattern: string, contextFlags = ''): RegexAnalysis {
  const { source, flags } = splitPattern(pattern, contextFlags);
  const result: RegexAnalysis = { source, flags, tokens: [], highlights: [], steps: [], hints: [] };
  if (!source) return result;
  let ast: AST.Pattern;
  try {
    ast = new RegExpParser({ ecmaVersion: 2025 }).parsePattern(source, 0, source.length, {
      unicode: flags.includes('u'),
      unicodeSets: flags.includes('v'),
    });
  } catch (e) {
    const index = e instanceof RegExpSyntaxError ? e.index : 0;
    result.error = { message: (e as Error).message.replace(/^Invalid regular expression: \/.*\/[a-z]*: /s, ''), index };
    return result;
  }
  const dotAll = flags.includes('s');
  const multiline = flags.includes('m');

  // Number the capturing groups in source order, as the engine does.
  groupCounter = new Map();
  let n = 0;
  const number = (node: AST.Node) => {
    if (node.type === 'CapturingGroup') groupCounter.set(node, ++n);
    const children = childrenOf(node);
    children.forEach(number);
  };
  number(ast);

  const highlight = (start: number, end: number, kind: TokenKind) => result.highlights.push({ start, end, kind });
  const brackets = (node: AST.Group | AST.CapturingGroup | AST.LookaroundAssertion, kind: TokenKind) => {
    const first = node.alternatives[0];
    highlight(node.start, first ? first.start : node.end - 1, kind); // '(', '(?:', '(?<name>', '(?=' ...
    highlight(node.end - 1, node.end, kind);
  };
  const collect = (node: AST.Node) => {
    const kind = kindOf(node);
    if (node.type === 'Quantifier') {
      // Hovering '+' or '{3}' explains just that suffix; what it repeats has its own explanation.
      const start = node.element.end;
      result.tokens.push({ start, end: node.end, kind: 'quantifier', raw: source.slice(start, node.end), explanation: explainToken(node, dotAll, multiline) });
    } else if (kind) {
      result.tokens.push({ start: node.start, end: node.end, kind, raw: node.raw, explanation: explainToken(node, dotAll, multiline) });
    }
    switch (node.type) {
      case 'Quantifier':
        highlight(node.element.end, node.end, 'quantifier');
        break;
      case 'Group':
      case 'CapturingGroup':
        brackets(node, 'group');
        break;
      case 'Assertion':
        if (node.kind === 'lookahead' || node.kind === 'lookbehind') brackets(node, 'lookaround');
        else highlight(node.start, node.end, 'anchor');
        break;
      case 'CharacterClass':
        highlight(node.start, node.end, 'class');
        return; // its content is part of the class's colour
      case 'CharacterSet':
        highlight(node.start, node.end, 'set');
        break;
      case 'Backreference':
        highlight(node.start, node.end, 'backref');
        break;
      case 'Pattern':
        node.alternatives.slice(0, -1).forEach((a) => highlight(a.end, a.end + 1, 'alternation'));
        break;
    }
    if (node.type === 'Group' || node.type === 'CapturingGroup' || (node.type === 'Assertion' && 'alternatives' in node)) {
      node.alternatives.slice(0, -1).forEach((a) => highlight(a.end, a.end + 1, 'alternation'));
    }
    childrenOf(node).forEach(collect);
  };
  collect(ast);

  for (const alternative of ast.alternatives) {
    for (const element of alternative.elements) {
      result.steps.push({ start: element.start, end: element.end, kind: kindOf(element) ?? 'literal', raw: element.raw, explanation: describe(element, dotAll, multiline) });
    }
  }
  if (ast.alternatives.length > 1) {
    result.steps.unshift({ start: 0, end: source.length, kind: 'alternation', raw: source, explanation: `${ast.alternatives.length} alternatives: the value may match any of them` });
  }
  result.hints = hintsFor(ast, source, flags);
  return result;
}

function childrenOf(node: AST.Node): AST.Node[] {
  switch (node.type) {
    case 'Pattern':
    case 'Group':
    case 'CapturingGroup':
      return node.alternatives;
    case 'Alternative':
      return node.elements;
    case 'Assertion':
      return node.kind === 'lookahead' || node.kind === 'lookbehind' ? node.alternatives : [];
    case 'Quantifier':
      return [node.element];
    case 'CharacterClass':
      return node.elements as AST.Node[];
    default:
      return [];
  }
}

/** The explanation shown when hovering a piece: what it matches, in words. */
function explainToken(node: AST.Node, dotAll: boolean, multiline: boolean): string {
  if (node.type === 'Quantifier') {
    const lazy = node.greedy ? '' : ' The ? after it makes it match as few as possible.';
    return `Repeats what comes before it ${times(node)}.${lazy}`;
  }
  if (node.type === 'Group') return `A group: ${describeAlternatives(node.alternatives, dotAll, multiline)}. It only groups (for a repeat or an alternative); it doesn't capture.`;
  if (node.type === 'CapturingGroup') return `Group ${node.name ? `'${node.name}'` : groupNumber(node)}: ${describeAlternatives(node.alternatives, dotAll, multiline)}.`;
  if (node.type === 'Character' && /^\\./.test(node.raw)) return `${describe(node, dotAll, multiline)} (escaped, so it means the character itself)`;
  const text = describe(node, dotAll, multiline);
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

function hintsFor(ast: AST.Pattern, source: string, flags: string): RegexHint[] {
  const hints: RegexHint[] = [];
  const multiline = flags.includes('m');

  // The validator passes when any part of the value matches (RegExp.test): anchors make it the whole value.
  const startsAnchored = ast.alternatives.every((a) => a.elements[0]?.type === 'Assertion' && a.elements[0].kind === 'start');
  const endsAnchored = ast.alternatives.every((a) => {
    const last = a.elements[a.elements.length - 1];
    return last?.type === 'Assertion' && last.kind === 'end';
  });
  if (!startsAnchored || !endsAnchored) {
    const missing = !startsAnchored && !endsAnchored ? '^ and $' : !startsAnchored ? '^' : '$';
    const body = ast.alternatives.length > 1 ? `(?:${source})` : source;
    const anchored = `${startsAnchored ? '' : '^'}${body}${endsAnchored ? '' : '$'}`;
    hints.push({
      severity: 'warning',
      message: `A value passes if any part of it matches: without ${missing}, '${example(ast)}' would also pass. To check the whole value, start with ^ and end with $.`,
      fix: { label: `Add ${missing}`, pattern: anchored },
    });
  }
  if (multiline && (startsAnchored || endsAnchored)) {
    hints.push({ severity: 'info', message: 'With the m flag, ^ and $ match at every line, so a value with several lines passes if one line matches.' });
  }

  // The server runs the same rule (.NET, through the library's JsRegExp).
  const usesUnicodeSensitive = /\\[dwbDWB]/.test(source);
  if (flags.includes('s') && usesUnicodeSensitive) {
    hints.push({
      severity: 'info',
      message: 'With the s flag the .NET server matches in its standard mode, where \\d, \\w and \\b also accept non-ASCII digits and letters (such as Arabic-Indic digits). The browser accepts only ASCII.',
    });
  }
  if (/\\[pP]\{/.test(source)) {
    hints.push({ severity: 'info', message: 'Unicode property escapes (\\p{…}) need the u flag in the browser, and .NET names some properties differently: check the rule on the server too.' });
  }
  return hints;
}

/** A value with extra text around something the pattern matches, to show why anchors matter. */
function example(ast: AST.Pattern): string {
  const first = ast.alternatives[0];
  const sample = first.elements.map(sampleOf).join('');
  return `x${sample || 'a'}x`;
}

function sampleOf(node: AST.Node): string {
  switch (node.type) {
    case 'Character':
      return String.fromCodePoint(node.value);
    case 'CharacterSet':
      return node.kind === 'digit' && !node.negate ? '1' : node.kind === 'space' && !node.negate ? ' ' : 'a';
    case 'CharacterClass': {
      const first = node.elements[0];
      if (node.negate || !first) return '#';
      if (first.type === 'CharacterClassRange') return String.fromCodePoint(first.min.value);
      if (first.type === 'Character') return String.fromCodePoint(first.value);
      return 'a';
    }
    case 'Quantifier':
      return sampleOf(node.element).repeat(Math.max(1, Math.min(node.min, 5)));
    case 'Group':
    case 'CapturingGroup':
      return node.alternatives[0].elements.map(sampleOf).join('');
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Testing values

export interface SampleResult {
  value: string;
  /** What the validator would say: the value passes. */
  passes: boolean;
  /** Where the pattern matches in the value, for highlighting. */
  matches: { start: number; end: number }[];
}

/**
 * Tests values the way the `pattern` validator does: `test()` on the whole value, from the start each time. Empty
 * values pass, as the validator lets them through. Returns undefined when the pattern doesn't compile.
 */
export function testSamples(pattern: string, contextFlags: string, values: readonly string[]): SampleResult[] | undefined {
  const { source, flags } = splitPattern(pattern, contextFlags);
  let regex: RegExp;
  let all: RegExp;
  try {
    regex = new RegExp(source, flags);
    all = new RegExp(source, flags.includes('g') ? flags : flags + 'g');
  } catch {
    return undefined;
  }
  return values.map((value) => {
    regex.lastIndex = 0;
    const passes = value === '' || regex.test(value);
    const matches: { start: number; end: number }[] = [];
    all.lastIndex = 0;
    for (let m = all.exec(value); m; m = all.exec(value)) {
      if (m[0].length === 0) {
        all.lastIndex++;
        continue;
      }
      matches.push({ start: m.index, end: m.index + m[0].length });
      if (matches.length > 50) break;
    }
    return { value, passes, matches };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Patterns to start from

export interface CommonPattern {
  label: string;
  pattern: string;
  /** A built-in validator that does the same, which is the better choice. */
  builtIn?: string;
}

export const COMMON_PATTERNS: CommonPattern[] = [
  { label: 'Letters only', pattern: '^[A-Za-z]+$' },
  { label: 'Letters and spaces', pattern: '^[A-Za-z ]+$' },
  { label: "A name: letters, spaces, hyphens, apostrophes", pattern: "^[A-Za-z][A-Za-z '-]*$" },
  { label: 'Letters and digits', pattern: '^[A-Za-z0-9]+$' },
  { label: 'Digits only', pattern: '^\\d+$' },
  { label: 'A code: 3 capital letters', pattern: '^[A-Z]{3}$' },
  { label: 'A code: 2 capital letters, then 4 digits', pattern: '^[A-Z]{2}\\d{4}$' },
  { label: 'No spaces at the start or end', pattern: '^\\S(?:.*\\S)?$' },
  { label: 'No spaces at all', pattern: '^\\S+$' },
  { label: 'A hex colour, #fff or #ffffff', pattern: '^#(?:[0-9a-fA-F]{3}){1,2}$' },
  { label: 'U.S. ZIP or ZIP+4', pattern: '^\\d{5}(?:-\\d{4})?$', builtIn: 'zipCode' },
  { label: 'U.S. state abbreviation', pattern: '^[A-Z]{2}$' },
  { label: 'U.S. phone, 10 digits', pattern: '^\\(?\\d{3}\\)?[-. ]?\\d{3}[-. ]?\\d{4}$', builtIn: 'phone' },
  { label: 'Whole number', pattern: '^-?\\d+$', builtIn: 'integer' },
];
