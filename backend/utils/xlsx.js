/**
 * Minimal, dependency-free .xlsx writer.
 *
 * An .xlsx file is just a ZIP archive holding a handful of XML parts, so we
 * build both by hand rather than pulling in exceljs/sheetjs. That keeps
 * `npm install` on the host machine exactly as it is today — important because
 * SmartODL is deployed by copying the folder across, not from a registry.
 *
 * Deflate comes from node's built-in zlib; the CRC-32 the ZIP format wants is
 * the only piece we have to compute ourselves.
 *
 * Usage:
 *   const { buildXlsx } = require('./xlsx');
 *   const buf = buildXlsx({ sheets: [{ name: 'Leaderboard', columns, rows }] });
 *
 *   columns: [{ header: 'Rank', width: 8 }, ...]
 *   rows:    [[1, 'Asha', 18.5], ...]   // numbers stay numeric in Excel
 *
 * A cell may also be an object for per-cell control:
 *   { value: 92.5, format: 'decimal' }   // 'text' | 'number' | 'decimal'
 */

const zlib = require('zlib');

/* ----------------------------------------------------------------- CRC-32 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* -------------------------------------------------------------- ZIP writer */

/**
 * Builds a ZIP archive from `[{ name, data }]`.
 *
 * Everything is stored with a fixed 1980-01-01 DOS timestamp so the same input
 * always produces a byte-identical file — handy when diffing exports.
 */
function zipSync(entries) {
  const DOS_TIME = 0;      // 00:00:00
  const DOS_DATE = 0x0021; // 1980-01-01
  const locals = [];
  const centrals = [];
  let offset = 0;

  entries.forEach((entry) => {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    // Only compress when it actually helps; tiny XML parts can grow.
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // extra field length
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);         // extra
    central.writeUInt16LE(0, 32);         // comment
    central.writeUInt16LE(0, 34);         // disk number
    central.writeUInt16LE(0, 36);         // internal attrs
    central.writeUInt32LE(0, 38);         // external attrs
    central.writeUInt32LE(offset, 42);    // local header offset
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  });

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);       // end of central directory
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);               // comment length

  return Buffer.concat([...locals, centralBuf, end]);
}

/* ------------------------------------------------------------- XML helpers */

const esc = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')
  // Excel refuses to open a file containing raw control characters, which can
  // reach us through free-text answers pasted by students.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** 1 -> A, 27 -> AA */
function colLetter(index) {
  let n = index;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const STYLE = { text: 0, header: 1, decimal: 2 };

/* ------------------------------------------------------------- sheet build */

function sheetXml(sheet) {
  const columns = sheet.columns || [];
  const rows = sheet.rows || [];
  const lastCol = colLetter(Math.max(1, columns.length));
  const lastRow = rows.length + 1;

  const cols = columns.length
    ? `<cols>${columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Number(c.width) || 16}" customWidth="1"/>`).join('')}</cols>`
    : '';

  const headerCells = columns.map((c, i) => (
    `<c r="${colLetter(i + 1)}1" s="${STYLE.header}" t="inlineStr"><is><t>${esc(c.header ?? '')}</t></is></c>`
  )).join('');
  const headerRow = `<row r="1" ht="20" customHeight="1">${headerCells}</row>`;

  const bodyRows = rows.map((row, r) => {
    const cells = row.map((cell, i) => {
      const ref = `${colLetter(i + 1)}${r + 2}`;
      const obj = cell && typeof cell === 'object' && !(cell instanceof Date) ? cell : { value: cell };
      const value = obj.value;

      if (value === null || value === undefined || value === '') return '';

      const numeric = typeof value === 'number' && Number.isFinite(value);
      if (numeric) {
        const s = obj.format === 'decimal' ? STYLE.decimal : STYLE.text;
        return `<c r="${ref}" s="${s}"><v>${value}</v></c>`;
      }
      return `<c r="${ref}" s="${STYLE.text}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 2}">${cells}</row>`;
  }).join('');

  // Element order below follows the CT_Worksheet schema sequence — Excel is
  // strict about it and silently reports "unreadable content" when it slips.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<dimension ref="A1:${lastCol}${Math.max(1, lastRow)}"/>`
    + '<sheetViews><sheetView workbookViewId="0" tabSelected="1">'
    + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
    + '</sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + cols
    + `<sheetData>${headerRow}${bodyRows}</sheetData>`
    + (rows.length ? `<autoFilter ref="A1:${lastCol}${lastRow}"/>` : '')
    + '</worksheet>';
}

/* ---------------------------------------------------------------- workbook */

function buildXlsx({ sheets }) {
  const list = (sheets || []).filter(Boolean);
  if (!list.length) throw new Error('buildXlsx: at least one sheet is required');

  // Excel caps sheet names at 31 chars and forbids : \ / ? * [ ]
  const safeName = (name, i) => (String(name || `Sheet${i + 1}`)
    .replace(/[\\/:*?[\]]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`);

  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '</Types>';

  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>';

  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + list.map((s, i) => `<sheet name="${esc(safeName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
    + '</sheets></workbook>';

  const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + '</Relationships>';

  // fills 0 and 1 are reserved by the spec (none / gray125), so the header
  // fill has to live at index 2.
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>'
    + '<fonts count="2">'
    + '<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
    + '</fonts>'
    + '<fills count="3">'
    + '<fill><patternFill patternType="none"/></fill>'
    + '<fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FF0F2537"/><bgColor indexed="64"/></patternFill></fill>'
    + '</fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="3">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>'
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    + '</cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>';

  return zipSync([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/styles.xml', data: styles },
    ...list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ]);
}

module.exports = { buildXlsx };
