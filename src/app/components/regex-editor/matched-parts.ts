/** A piece of a value to try: matched by the pattern (highlighted) or not. */
export interface Part {
  text: string;
  match: boolean;
}

/** One value to try, as the regex editor shows it under "Should pass" or "Should fail". */
export interface Row {
  /** Whether the validator accepts the value. */
  passes: boolean;
  /** Whether that's what the column expects. */
  ok: boolean;
  parts: Part[];
}

/** Splits `value` into matched and unmatched parts, by the matches' ranges (in order, not overlapping). */
export function split(value: string, matches: { start: number; end: number }[]): Part[] {
  const parts: Part[] = [];
  let at = 0;
  for (const m of matches) {
    if (m.start > at) parts.push({ text: value.slice(at, m.start), match: false });
    parts.push({ text: value.slice(m.start, m.end), match: true });
    at = m.end;
  }
  if (at < value.length) parts.push({ text: value.slice(at), match: false });
  return parts;
}
