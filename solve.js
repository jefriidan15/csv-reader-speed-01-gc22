// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader): run(input) returns exactly
// readCsv(input)'s {columns, rows, errors} for every input, but scans with C++-accelerated
// indexOf/slice instead of one character at a time.
//
// Semantics (mirroring the reference exactly):
//  - a U+FEFF at the very start is dropped;
//  - a record ends at LF or CRLF; a line left with no characters is no record;
//  - outside quotes a CR not followed by LF is dropped (stray_cr);
//  - a field opening with a quote runs to the next quote that is not doubled ("" inside is one
//    quote, each CRLF or lone CR inside is read as LF); what follows its closing quote, up to
//    the next comma or line break, is appended as it stands (quote_junk, when the field ends);
//    a quote that never closes is a literal character and the text after it is read again as
//    unquoted (unterminated_quote);
//  - a quote inside an unquoted field is a literal character; fields stay strings, never
//    trimmed or converted;
//  - columns is the first record when header is true, else null; rows are padded with ""
//    (short_row, with fields: its field count) or cut (long_row, with extra: the cut fields)
//    to the first record's width;
//  - each error is {code, line, row}: line the 1-based line its record starts on (every LF,
//    CRLF and lone CR inside a quoted field counted), row its record's index in rows (null
//    for the header), in the order met, a field's quote_junk when the field ends and a
//    record's short_row or long_row when the record ends.
//
// Speed: the common field (unquoted, no stray CR) is one slice bounded by two indexOf calls;
// the common quoted field (no doubled quote, no CR/LF inside) is one indexOf for its closing
// quote plus one slice. Only broken fields fall back to the segment-accumulating slow paths,
// which re-scan exactly as the reference does.

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xFEFF) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // What the last field read was: its value, how it ended (1 comma, 2 line break, 3 end of
  // text) and, for the unquoted reader, how many characters it kept.
  let fValue = '';
  let fEnd = 0;
  let fAdded = 0;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field from pos, starting from `initial` ('' normally, '"' for an
  // unterminated re-read, a quoted field's value for the junk after its closing quote): a CR
  // not followed by LF is dropped (stray_cr). Sets fValue, fEnd, fAdded.
  function readUnquoted(initial) {
    const parts = [];
    if (initial !== '') parts.push(initial);
    let seg = pos;
    fAdded = 0;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        // ,
        if (pos > seg) parts.push(text.slice(seg, pos));
        pos += 1;
        fValue = parts.length === 1 ? parts[0] : parts.join('');
        fEnd = 1;
        return;
      }
      if (c === 10) {
        // \n
        if (pos > seg) parts.push(text.slice(seg, pos));
        pos += 1;
        line += 1;
        fValue = parts.length === 1 ? parts[0] : parts.join('');
        fEnd = 2;
        return;
      }
      if (c === 13) {
        // \r
        if (text.charCodeAt(pos + 1) === 10) {
          if (pos > seg) parts.push(text.slice(seg, pos));
          pos += 2;
          line += 1;
          fValue = parts.length === 1 ? parts[0] : parts.join('');
          fEnd = 2;
          return;
        }
        error('stray_cr');
        if (pos > seg) parts.push(text.slice(seg, pos));
        pos += 1;
        seg = pos;
        continue;
      }
      fAdded += 1;
      pos += 1;
    }
    if (pos > seg) parts.push(text.slice(seg, pos));
    fValue = parts.length === 0 ? '' : parts.length === 1 ? parts[0] : parts.join('');
    fEnd = 3;
  }

  // Reads a quoted field whose opening quote is at pos, when its span holds a doubled quote or
  // a CR/LF (the clean case is handled inline in readQuoted). Rebuilds the value with "" as
  // one quote and each CRLF or lone CR as LF, counting the lines it spans. Sets fValue, fEnd.
  function readQuotedSlow(open, openLine) {
    let p = open + 1;
    let l = openLine;
    const parts = [];
    let seg = p;
    let closed = false;
    while (p < len) {
      const c = text.charCodeAt(p);
      if (c === 34) {
        // "
        if (text.charCodeAt(p + 1) === 34) {
          if (p > seg) parts.push(text.slice(seg, p));
          parts.push('"');
          p += 2;
          seg = p;
          continue;
        }
        p += 1;
        closed = true;
        break;
      }
      if (c === 13) {
        // \r: CRLF and a lone CR inside quotes are each one LF.
        if (p > seg) parts.push(text.slice(seg, p));
        parts.push('\n');
        l += 1;
        p += text.charCodeAt(p + 1) === 10 ? 2 : 1;
        seg = p;
        continue;
      }
      if (c === 10) l += 1;
      p += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it is read
      // again as unquoted. line is still openLine: the failed scan counted into l only.
      pos = open + 1;
      error('unterminated_quote');
      readUnquoted('"');
      return;
    }
    if (p - 1 > seg) parts.push(text.slice(seg, p - 1));
    const v = parts.length === 0 ? '' : parts.length === 1 ? parts[0] : parts.join('');
    line = l;
    pos = p;
    if (pos >= len) {
      fValue = v;
      fEnd = 3;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fValue = v;
      fEnd = 1;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fValue = v;
      fEnd = 2;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fValue = v;
      fEnd = 2;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line
    // break.
    readUnquoted(v);
    if (fAdded > 0) error('quote_junk');
  }

  // Reads a quoted field whose opening quote is at pos. Sets fValue, fEnd.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let q = text.indexOf('"', open + 1);
    if (q === -1) {
      // No later quote at all: it never closes.
      pos = open + 1;
      error('unterminated_quote');
      readUnquoted('"');
      return;
    }
    let doubled = false;
    while (text.charCodeAt(q + 1) === 34) {
      doubled = true;
      q = text.indexOf('"', q + 2);
      if (q === -1) {
        pos = open + 1;
        error('unterminated_quote');
        readUnquoted('"');
        return;
      }
    }
    if (!doubled) {
      const v = text.slice(open + 1, q);
      if (v.indexOf('\r') === -1 && v.indexOf('\n') === -1) {
        // Clean quoted field: no doubled quote, no line break inside.
        pos = q + 1;
        if (pos >= len) {
          fValue = v;
          fEnd = 3;
          return;
        }
        const c = text.charCodeAt(pos);
        if (c === 44) {
          pos += 1;
          fValue = v;
          fEnd = 1;
          return;
        }
        if (c === 10) {
          pos += 1;
          line += 1;
          fValue = v;
          fEnd = 2;
          return;
        }
        if (c === 13 && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          fValue = v;
          fEnd = 2;
          return;
        }
        // What follows the closing quote is appended as it stands.
        readUnquoted(v);
        if (fAdded > 0) error('quote_junk');
        return;
      }
    }
    readQuotedSlow(open, openLine);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    for (;;) {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) {
        readQuoted();
      } else {
        // Unquoted field: it ends at the nearest comma, line break or end of text.
        const comma = text.indexOf(',', pos);
        const nl = text.indexOf('\n', pos);
        let end;
        let isComma = false;
        if (comma !== -1 && (nl === -1 || comma < nl)) {
          end = comma;
          isComma = true;
        } else if (nl !== -1) {
          end = nl;
        } else {
          end = len;
        }
        // A CR at the end of the field before its LF is the CRLF's, not a stray one.
        let fEndPos = end;
        if (!isComma && end === nl && end > pos && text.charCodeAt(end - 1) === 13) fEndPos = end - 1;
        const f = text.slice(pos, fEndPos);
        if (f.indexOf('\r') === -1) {
          fValue = f;
          if (isComma) {
            pos = end + 1;
            fEnd = 1;
          } else if (end === nl) {
            pos = end + 1;
            line += 1;
            fEnd = 2;
          } else {
            pos = len;
            fEnd = 3;
          }
        } else {
          // A stray CR hides in the field: re-read it the slow way.
          readUnquoted('');
        }
      }
      fields.push(fValue);
      if (fEnd !== 1) break;
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr
    // errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
