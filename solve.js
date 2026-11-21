// A fast drop-in for make.fun's csv-reader 1.0.0.
//
// run(input) returns exactly what csv-reader 1.0.0 returns for {text, header}: the JSON value
// {columns, rows, errors}. The policy is the one the competition states: a U+FEFF at the very start
// is dropped; a record ends at LF or CRLF and a line left with no characters is no record; outside
// quotes a CR not followed by LF is dropped (stray_cr); a field that opens with a quote runs to the
// next quote that is not doubled, "" inside it one quote, each CRLF or lone CR inside it read as LF;
// what follows its closing quote, up to the next comma or line break, is appended as it stands
// (quote_junk, when the field ends); a quote that never closes is a literal character and the text
// after it is read again as unquoted (unterminated_quote); a quote inside an unquoted field is a
// literal character; fields stay strings, never trimmed or converted; columns is the first record when
// header is true, else null; rows holds the records after it, each padded with "" (short_row) or cut
// (long_row) to the first record's width; each error is {code, line, row} in the order met.
//
// Where the reference reads one character at a time and builds each field a character at a time, this
// reader jumps between delimiters with indexOf and takes each field with one slice: the common path —
// a plain unquoted field — is one indexOf for the next comma, one slice, and one short scan for a
// stray CR. Quoted fields find their closing quote with indexOf and only rebuild their value when the
// content holds a doubled quote, a newline, or a CR. Nothing is kept from one call to the next.

/** How a field ended: at a comma (the record goes on), at a line break, or at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input, {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The first LF at or after the record's start (or len): the record's end unless a quoted field
  // spans a line break, after which it is recomputed. An unquoted field ends at the next comma or
  // at this position, whichever comes first.
  let recordEnd = len;

  // How the field just read ended.
  let ended = COMMA;

  function pushError(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // A quoted field's raw content, with every CRLF and lone CR inside it read as one LF, and the
  // line count moved on by every line break inside it. The common case — no CR and no LF — returns
  // the slice untouched.
  function normalizeQuoted(v) {
    if (v.indexOf('\r') === -1) {
      let n = 0;
      let i = v.indexOf('\n');
      while (i !== -1) {
        n += 1;
        i = v.indexOf('\n', i + 1);
      }
      line += n;
      return v;
    }
    let out = '';
    let s = 0;
    let n = 0;
    for (let i = 0; i < v.length; i += 1) {
      const c = v.charCodeAt(i);
      if (c === 13) {
        out += v.slice(s, i) + '\n';
        n += 1;
        if (v.charCodeAt(i + 1) === 10) i += 1; // the LF half of a CRLF
        s = i + 1;
      } else if (c === 10) {
        n += 1;
      }
    }
    out += v.slice(s);
    line += n;
    return out;
  }

  // Reads an unquoted field onto `seed`, up to the next comma or line break: a CR not followed by
  // LF is dropped (stray_cr). Sets `ended` and moves `pos` (and `line` on a line break) past the
  // field and its terminator. Returns the field's value.
  function unquoted(seed) {
    const comma = text.indexOf(',', pos);
    let end;
    if (comma !== -1 && comma < recordEnd) {
      end = comma;
      ended = COMMA;
    } else if (recordEnd < len) {
      end = recordEnd;
      ended = LINE_BREAK;
    } else {
      end = len;
      ended = END;
    }
    // A CR just before the line break is the CRLF's first half, not part of the field.
    let fieldEnd = end;
    if (ended === LINE_BREAK && end > pos && text.charCodeAt(end - 1) === 13) fieldEnd = end - 1;
    let v = text.slice(pos, fieldEnd);
    if (v.indexOf('\r') !== -1) {
      // Rare: stray CRs inside the field — drop them, one error each.
      let clean = '';
      let s = 0;
      let i = v.indexOf('\r');
      while (i !== -1) {
        clean += v.slice(s, i);
        pushError('stray_cr');
        s = i + 1;
        i = v.indexOf('\r', s);
      }
      clean += v.slice(s);
      v = clean;
    }
    pos = ended === END ? end : end + 1;
    if (ended === LINE_BREAK) line += 1;
    return seed + v;
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
    recordEnd = text.indexOf('\n', pos);
    if (recordEnd === -1) recordEnd = len;
    let quoted = false;

    do {
      if (text.charCodeAt(pos) === 34) {
        // A field that opens with a quote.
        quoted = true;
        const open = pos;
        const openLine = line;
        let p = open + 1;
        let q = text.indexOf('"', p);
        let value;
        let closed = false;
        if (q !== -1 && text.charCodeAt(q + 1) !== 34) {
          // The first quote after the opening one closes the field: no doubled quotes inside.
          value = text.slice(p, q);
          pos = q + 1;
          closed = true;
        } else if (q !== -1) {
          // Doubled quotes inside: accumulate the segments, "" counting as one quote.
          let acc = '';
          while (q !== -1) {
            if (text.charCodeAt(q + 1) === 34) {
              acc += text.slice(p, q) + '"';
              p = q + 2;
              q = text.indexOf('"', p);
              continue;
            }
            acc += text.slice(p, q);
            pos = q + 1;
            closed = true;
            break;
          }
          value = acc;
        }
        if (!closed) {
          // The quote never closes: it is a literal character, and the text after it is read
          // again as an unquoted field, the line count back where the quote opened.
          pos = open + 1;
          line = openLine;
          pushError('unterminated_quote');
          fields.push(unquoted('"'));
        } else {
          // A field that closed before the record's first LF holds no LF in its content, so it
          // only needs normalising when it holds a CR (or spans a line break, pos past recordEnd).
          if (pos > recordEnd || value.indexOf('\r') !== -1) value = normalizeQuoted(value);
          if (pos > recordEnd) {
            // The quoted field spanned a line break: the record ends at a later LF.
            recordEnd = text.indexOf('\n', pos);
            if (recordEnd === -1) recordEnd = len;
          }
          if (pos >= len) {
            fields.push(value);
            ended = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              fields.push(value);
              ended = COMMA;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              fields.push(value);
              ended = LINE_BREAK;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              fields.push(value);
              ended = LINE_BREAK;
            } else {
              // What follows the closing quote is appended as it stands, up to the next comma
              // or line break; quote_junk when anything was appended.
              const junk = unquoted(value);
              if (junk.length > value.length) pushError('quote_junk');
              fields.push(junk);
            }
          }
        }
      } else {
        quoted = false;
        // Unquoted field, inlined fast path (the common case): the next comma or the
        // record's end, one slice, one short scan for a stray CR. Inlined rather than
        // calling unquoted() because this is where nearly all of the time goes.
        const comma = text.indexOf(',', pos);
        let end;
        if (comma !== -1 && comma < recordEnd) {
          end = comma;
          ended = COMMA;
        } else if (recordEnd < len) {
          end = recordEnd;
          ended = LINE_BREAK;
        } else {
          end = len;
          ended = END;
        }
        // A CR just before the line break is the CRLF's first half, not part of the field.
        let fieldEnd = end;
        if (ended === LINE_BREAK && end > pos && text.charCodeAt(end - 1) === 13) fieldEnd = end - 1;
        let v = text.slice(pos, fieldEnd);
        if (v.indexOf('\r') !== -1) {
          // Rare: stray CRs inside the field — drop them, one error each.
          let clean = '';
          let s = 0;
          let i = v.indexOf('\r');
          while (i !== -1) {
            clean += v.slice(s, i);
            pushError('stray_cr');
            s = i + 1;
            i = v.indexOf('\r', s);
          }
          clean += v.slice(s);
          v = clean;
        }
        pos = ended === END ? end : end + 1;
        if (ended === LINE_BREAK) line += 1;
        fields.push(v);
      }
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
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
