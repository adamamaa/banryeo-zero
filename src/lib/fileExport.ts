// 에이전트가 만든 파일(엑셀·CSV·워드·텍스트·캘린더).
// 서버는 내용만 검사해 보내고, 실제 파일은 다운로드할 때 브라우저에서 만든다 (대화 기록에는 내용만 저장).
// 외부 라이브러리 없이 Office 형식(XML을 묶은 ZIP)을 직접 쓴다.
import { buildIcs } from "./ics";
import type { Gov24Notice } from "./gov24";

export type FileFormat = "xlsx" | "csv" | "docx" | "txt" | "ics";
export const FILE_FORMATS: FileFormat[] = ["xlsx", "csv", "docx", "txt", "ics"];

export interface FileSheet {
  name: string;
  columns: string[];
  rows: string[][];
  // 합계 행을 넣을 열 이름 (AI가 더하지 않고 파일의 수식으로 계산)
  sumColumns?: string[];
}
export interface FileEvent {
  date: string; // YYYY-MM-DD
  title: string;
  note?: string;
}
export interface GeneratedFile {
  format: FileFormat;
  fileName: string;
  description: string;
  sheets: FileSheet[];
  content: string;
  events: FileEvent[];
}

export const FORMAT_LABEL: Record<FileFormat, string> = {
  xlsx: "엑셀",
  csv: "CSV",
  docx: "워드",
  txt: "텍스트",
  ics: "캘린더",
};
const MIME: Record<FileFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv;charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain;charset=utf-8",
  ics: "text/calendar;charset=utf-8",
};

const LIMIT = { sheets: 5, columns: 20, rows: 500, cell: 1000, content: 30000, events: 50, total: 150000 };
// XML에 넣을 수 없는 제어 문자
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const clean = (v: unknown, max: number) => String(v ?? "").replace(CONTROL, "").trim().slice(0, max);
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []); // eslint-disable-line @typescript-eslint/no-explicit-any

// ---------- AI가 준 값 검사 ----------

const SOURCE_NAME = { youth: "온통청년", welfare: "복지로", gov24: "보조금24" } as const;
const deadlineOf = (n: Gov24Notice) => (n.applyEnd ? `${n.applyEnd}까지` : n.deadlineText);

// 공고는 AI가 옮겨 적지 않고 조회한 원본으로 표를 만든다
function noticeSheet(notices: Gov24Notice[]): FileSheet {
  return {
    name: "공고 목록",
    columns: ["공고명", "기관", "지원 내용", "신청 대상", "신청 기한", "신청처", "출처", "링크"],
    rows: notices.map((n) =>
      [n.name, n.org, n.summary, n.target, deadlineOf(n), n.applyAt, SOURCE_NAME[n.source || "gov24"], n.url].map((c) =>
        clean(c, LIMIT.cell)
      )
    ),
  };
}

const realDate = (v: string) => {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
};

function sheetName(raw: string, used: string[], i: number) {
  const base = raw.replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 28) || `시트${i + 1}`;
  let name = base;
  for (let n = 2; used.includes(name); n++) name = `${base} ${n}`;
  used.push(name);
  return name;
}

export function normalizeFile(
  args: Record<string, unknown>,
  found: (Gov24Notice & { ref: string })[],
  mask: (text: string) => string = (t) => t
): { file: GeneratedFile } | { error: string } {
  const format = String(args.format || "").toLowerCase() as FileFormat;
  if (!FILE_FORMATS.includes(format)) return { error: `format은 ${FILE_FORMATS.join(", ")} 중 하나여야 합니다.` };

  const text = (v: unknown, max: number) => mask(clean(v, max));
  const used: string[] = [];
  const sheets: FileSheet[] = list(args.sheets)
    .slice(0, LIMIT.sheets)
    .map((s, i) => {
      // 표 칸은 서식을 해석하지 않으므로 ** 를 뗀다
      const cell = (v: unknown, max: number) => text(v, max).replace(/\*\*/g, "");
      const columns = list(s?.columns).map((c) => cell(c, 60)).slice(0, LIMIT.columns);
      const rows = list(s?.rows)
        .slice(0, LIMIT.rows)
        .map((r) => columns.map((_, c) => cell(list(r)[c], LIMIT.cell)))
        .filter((r) => r.some(Boolean));
      const sumColumns = list(s?.sumColumns).map((c) => clean(c, 60)).filter((c) => columns.includes(c));
      return { name: sheetName(clean(s?.name, 40), used, i), columns, rows, ...(sumColumns.length && { sumColumns }) };
    })
    .filter((s) => s.columns.some(Boolean));

  const refs = list(args.noticeRefs).map((r) => clean(r, 80)).filter(Boolean);
  const notices = refs.includes("all") ? found : found.filter((n) => refs.includes(n.ref));
  if (refs.length && !notices.length) return { error: "해당 공고가 없습니다. search_policies로 먼저 찾고 그 결과의 ref를 넣으세요." };
  if (notices.length && format !== "ics") {
    const sheet = noticeSheet(notices);
    sheets.unshift({ ...sheet, name: sheetName(sheet.name, used, 0) });
  }

  const content = text(args.content, LIMIT.content);
  const events: FileEvent[] = [
    ...list(args.events).map((e) => ({
      date: clean(e?.date, 10),
      title: text(e?.title, 100),
      note: text(e?.note, 300) || undefined,
    })),
    ...notices
      .filter((n) => format === "ics" && n.applyEnd)
      .map((n) => ({ date: n.applyEnd!, title: `${clean(n.name, 80)} 마감`, note: clean(`${n.org} ${n.url}`, 300) })),
  ]
    .filter((e) => e.title && realDate(e.date))
    .slice(0, LIMIT.events);

  if ((format === "xlsx" || format === "csv") && !sheets.length) return { error: "표 파일에는 columns와 rows가 있는 sheets가 필요합니다." };
  if ((format === "docx" || format === "txt") && !content && !sheets.length) return { error: "문서에 넣을 content가 없습니다." };
  if (format === "ics" && !events.length) return { error: "YYYY-MM-DD 날짜가 있는 일정이 없습니다. 기한이 정해진 일정만 넣을 수 있습니다." };

  const file: GeneratedFile = {
    format,
    fileName:
      clean(args.fileName, 80)
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\.(xlsx?|csv|docx?|txt|ics|pdf|hwpx?|pptx?)$/i, "")
        .trim()
        .slice(0, 60) || "공고패스_자료",
    description: text(args.description, 80),
    sheets: format === "csv" ? sheets.slice(0, 1) : format === "ics" ? [] : sheets,
    content: format === "docx" || format === "txt" ? content : "",
    events: format === "ics" ? events : [],
  };
  // 대화 기록(브라우저 저장소)에 함께 저장되므로 크기를 제한한다
  if (JSON.stringify(file).length > LIMIT.total) return { error: "파일 내용이 너무 큽니다. 행이나 글을 줄여 다시 만드세요." };
  return { file };
}

export function fileMeta(f: GeneratedFile) {
  const rows = f.sheets.reduce((n, s) => n + s.rows.length, 0);
  const detail =
    f.format === "ics"
      ? `일정 ${f.events.length}개`
      : f.format === "docx" || f.format === "txt"
      ? [f.content && `${f.content.length.toLocaleString("ko-KR")}자`, rows && `표 ${rows}행`].filter(Boolean).join(" · ")
      : `${f.sheets.length > 1 ? `시트 ${f.sheets.length}개 · ` : ""}${rows}행`;
  return `${FORMAT_LABEL[f.format]} · ${detail}`;
}

// ---------- 간단한 서식 글 (# 제목, - 목록, | 표 |) : 화면과 워드가 함께 쓴다 ----------

export type TextBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullet"; text: string }
  | { type: "table"; rows: string[][] }
  | { type: "code"; text: string };

export function parseBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let table: string[][] | null = null;
  // ``` 안의 줄은 들여쓰기와 # 주석까지 그대로 둔다
  let code: string[] | null = null;
  const flush = () => {
    if (table?.length) blocks.push({ type: "table", rows: table });
    table = null;
  };
  const flushCode = () => {
    if (code?.length) blocks.push({ type: "code", text: code.join("\n") });
    code = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      flush();
      if (code) flushCode();
      else code = [];
      continue;
    }
    if (code) {
      code.push(raw);
      continue;
    }
    if (/^\|.*\|$/.test(line)) {
      // | --- | --- | 구분선은 건너뛴다
      if (!/^\|[\s:|-]+\|$/.test(line)) (table = table || []).push(line.slice(1, -1).split("|").map((c) => c.trim()));
      continue;
    }
    flush();
    if (!line || /^([-*_])\1{2,}$/.test(line)) continue;
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    const b = line.match(/^[-*•]\s+(.+)$/);
    if (h) blocks.push({ type: "heading", level: h[1].length as 1 | 2 | 3, text: h[2] });
    else if (b) blocks.push({ type: "bullet", text: b[1] });
    else blocks.push({ type: "paragraph", text: line });
  }
  flush();
  flushCode();
  return blocks;
}

// ---------- ZIP (압축 없이 묶기) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function joinBytes(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function zip(entries: [string, string][]) {
  const enc = new TextEncoder();
  const DOS_DATE = 0x5c21; // 2026-01-01
  const body: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [path, text] of entries) {
    const name = enc.encode(path);
    const data = enc.encode(text);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    body.push(new Uint8Array(local.buffer), name, data);

    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 20, true);
    head.setUint16(14, DOS_DATE, true);
    head.setUint32(16, crc, true);
    head.setUint32(20, data.length, true);
    head.setUint32(24, data.length, true);
    head.setUint16(28, name.length, true);
    head.setUint32(42, offset, true);
    central.push(new Uint8Array(head.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const dir = joinBytes(central);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, dir.length, true);
  end.setUint32(16, offset, true);
  return joinBytes([...body, dir, new Uint8Array(end.buffer)]);
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const esc = (v: string) =>
  v.replace(CONTROL, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------- 엑셀 ----------

const colName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
// 0으로 시작하는 번호, 16자리 이상 숫자는 글자로 둔다
function toNumber(v: string): { value: number; comma: boolean } | null {
  const comma = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(v);
  if (!comma && !/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(v)) return null;
  return { value: Number(v.replace(/,/g, "")), comma };
}
const textWidth = (v: string) => Array.from(v).reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
const isUrl = (v: string) => /^https?:\/\/\S+$/.test(v) && v.length < 2000;

const STYLE = { header: 1, text: 2, number: 3, comma: 4, link: 5, totalLabel: 6, total: 7 };
const XLSX_STYLES = `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Malgun Gothic"/><family val="2"/></font><font><b/><sz val="11"/><name val="Malgun Gothic"/><family val="2"/></font><font><u/><sz val="11"/><color rgb="FF6B21A8"/><name val="Malgun Gothic"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3E8FF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFE2E8F0"/></left><right style="thin"><color rgb="FFE2E8F0"/></right><top style="thin"><color rgb="FFE2E8F0"/></top><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="3" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(s: FileSheet, index: number) {
  const textCell = (ref: string, v: string, style: number) =>
    v ? `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>` : `<c r="${ref}" s="${style}"/>`;
  const links: { ref: string; url: string }[] = [];
  const lastData = s.rows.length + 1;

  const header = `<row r="1" ht="24" customHeight="1">${s.columns.map((c, i) => textCell(`${colName(i)}1`, c, STYLE.header)).join("")}</row>`;
  const body = s.rows.map((row, y) => {
    const r = y + 2;
    const cells = row.map((v, x) => {
      const ref = `${colName(x)}${r}`;
      const num = toNumber(v);
      if (num) return `<c r="${ref}" s="${num.comma ? STYLE.comma : STYLE.number}"><v>${num.value}</v></c>`;
      if (isUrl(v)) {
        links.push({ ref, url: v });
        return textCell(ref, v, STYLE.link);
      }
      return textCell(ref, v, STYLE.text);
    });
    return `<row r="${r}">${cells.join("")}</row>`;
  });

  // 합계는 파일 안의 수식으로 (값이 바뀌면 함께 바뀐다)
  let total = "";
  if (s.sumColumns?.length && s.rows.length) {
    const r = lastData + 1;
    total = `<row r="${r}">${s.columns
      .map((c, x) => {
        const ref = `${colName(x)}${r}`;
        if (s.sumColumns!.includes(c)) {
          const sum = s.rows.reduce((n, row) => n + (toNumber(row[x])?.value || 0), 0);
          const col = colName(x);
          return `<c r="${ref}" s="${STYLE.total}"><f>SUM(${col}2:${col}${lastData})</f><v>${Math.round(sum * 1e6) / 1e6}</v></c>`;
        }
        return textCell(ref, x === 0 ? "합계" : "", STYLE.totalLabel);
      })
      .join("")}</row>`;
  }

  const widths = s.columns.map((c, x) => {
    const longest = Math.max(textWidth(c), ...s.rows.map((row) => textWidth(row[x] || "")));
    return Math.min(48, Math.max(9, longest + 2));
  });
  const end = colName(s.columns.length - 1);
  const xml = `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"${
    index === 0 ? ' tabSelected="1"' : ""
  }><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("")}</cols><sheetData>${header}${body.join("")}${total}</sheetData>${
    s.rows.length ? `<autoFilter ref="A1:${end}${lastData}"/>` : ""
  }${
    links.length
      ? `<hyperlinks>${links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rId${i + 1}"/>`).join("")}</hyperlinks>`
      : ""
  }</worksheet>`;
  return { xml, urls: links.map((l) => l.url) };
}

function xlsxBytes(f: GeneratedFile) {
  const built = f.sheets.map(sheetXml);
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
  const filters = f.sheets
    .map((s, i) =>
      s.rows.length
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name.replace(/'/g, "''"))}'!$A$1:$${colName(s.columns.length - 1)}$${s.rows.length + 1}</definedName>`
        : ""
    )
    .join("");
  const entries: [string, string][] = [
    [
      "[Content_Types].xml",
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${f.sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join("")}</Types>`,
    ],
    ["_rels/.rels", `${XML_HEAD}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    [
      "xl/workbook.xml",
      `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets>${f.sheets
        .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets>${filters && `<definedNames>${filters}</definedNames>`}<calcPr calcId="0" fullCalcOnLoad="1"/></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `${XML_HEAD}<Relationships xmlns="${PKG}">${f.sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("")}<Relationship Id="rId${f.sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    ],
    ["xl/styles.xml", XLSX_STYLES],
  ];
  built.forEach((b, i) => {
    entries.push([`xl/worksheets/sheet${i + 1}.xml`, b.xml]);
    if (b.urls.length) {
      entries.push([
        `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        `${XML_HEAD}<Relationships xmlns="${PKG}">${b.urls
          .map((u, k) => `<Relationship Id="rId${k + 1}" Type="${REL}/hyperlink" Target="${esc(u)}" TargetMode="External"/>`)
          .join("")}</Relationships>`,
      ]);
    }
  });
  return zip(entries);
}

// ---------- 워드 ----------

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const FONT = '<w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="Malgun Gothic" w:cs="Malgun Gothic"/>';

function runs(text: string, opts: { bold?: boolean; size?: number } = {}) {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) => {
      const strong = /^\*\*.+\*\*$/.test(part);
      const props = `${opts.bold || strong ? "<w:b/>" : ""}${opts.size ? `<w:sz w:val="${opts.size}"/>` : ""}`;
      return `<w:r>${props && `<w:rPr>${props}</w:rPr>`}<w:t xml:space="preserve">${esc(strong ? part.slice(2, -2) : part)}</w:t></w:r>`;
    })
    .join("");
}
const paragraph = (text: string, props = "", run: { bold?: boolean; size?: number } = {}) =>
  `<w:p>${props && `<w:pPr>${props}</w:pPr>`}${runs(text, run)}</w:p>`;

function wordTable(rows: string[][]) {
  const cols = Math.max(...rows.map((r) => r.length));
  const width = Math.floor(9026 / cols);
  const line = (n: string) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"]
    .map(line)
    .join("")}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array.from(
    { length: cols },
    () => `<w:gridCol w:w="${width}"/>`
  ).join("")}</w:tblGrid>${rows
    .map(
      (row, y) =>
        `<w:tr>${y === 0 ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${Array.from({ length: cols }, (_, x) => {
          const shade = y === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="F3E8FF"/>' : "";
          return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}</w:tcPr>${paragraph(row[x] || "", '<w:spacing w:before="40" w:after="40"/>', {
            bold: y === 0,
            size: 18,
          })}</w:tc>`;
        }).join("")}</w:tr>`
    )
    .join("")}</w:tbl>${paragraph("")}`;
}

function docxBytes(f: GeneratedFile) {
  const out: string[] = [];
  for (const b of parseBlocks(f.content)) {
    if (b.type === "heading") out.push(paragraph(b.text, `<w:pStyle w:val="Heading${b.level}"/>`));
    else if (b.type === "bullet") out.push(paragraph(`•  ${b.text}`, '<w:ind w:left="360" w:hanging="240"/>'));
    else if (b.type === "table") out.push(wordTable(b.rows));
    else if (b.type === "code") {
      for (const line of b.text.split("\n")) {
        out.push(
          `<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/><w:spacing w:after="0" w:line="260" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`
        );
      }
      out.push(paragraph(""));
    } else out.push(paragraph(b.text));
  }
  for (const s of f.sheets) {
    out.push(paragraph(s.name, '<w:pStyle w:val="Heading2"/>'));
    out.push(wordTable([s.columns, ...s.rows]));
  }
  const heading = (level: number, size: number, before: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
  return zip([
    [
      "[Content_Types].xml",
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    ],
    ["_rels/.rels", `${XML_HEAD}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`],
    ["word/_rels/document.xml.rels", `${XML_HEAD}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/></Relationships>`],
    [
      "word/styles.xml",
      `${XML_HEAD}<w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr>${FONT}<w:sz w:val="21"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading(1, 34, 120)}${heading(2, 26, 280)}${heading(3, 23, 200)}</w:styles>`,
    ],
    [
      "word/document.xml",
      `${XML_HEAD}<w:document ${W_NS}><w:body>${out.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    ],
  ]);
}

// ---------- 글자 형식 ----------

// 표 프로그램이 값을 수식으로 실행하지 않게 막는다 (숫자는 그대로)
const csvCell = (v: string) => {
  const safe = /^[=+\-@]/.test(v) && !toNumber(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csvText = (s: FileSheet) => [s.columns, ...s.rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
const plainText = (f: GeneratedFile) =>
  [f.content.replace(/\*\*/g, ""), ...f.sheets.map((s) => `[${s.name}]\r\n${[s.columns, ...s.rows].map((r) => r.join("\t")).join("\r\n")}`)]
    .filter(Boolean)
    .join("\r\n\r\n");

export function fileBytes(f: GeneratedFile): Uint8Array {
  const text = (v: string) => new TextEncoder().encode(v);
  if (f.format === "xlsx") return xlsxBytes(f);
  if (f.format === "docx") return docxBytes(f);
  // 엑셀·메모장에서 한글이 깨지지 않게 BOM을 붙인다
  if (f.format === "csv") return text(`﻿${csvText(f.sheets[0])}`);
  if (f.format === "txt") return text(`﻿${plainText(f)}`);
  return text(
    buildIcs(
      f.events.map((e) => {
        const [y, m, d] = e.date.split("-").map(Number);
        return { date: new Date(y, m - 1, d), title: e.title, desc: e.note };
      })
    )
  );
}

export const downloadName = (f: GeneratedFile) => `${f.fileName}.${f.format}`;

export function downloadFile(f: GeneratedFile) {
  const url = URL.createObjectURL(new Blob([fileBytes(f) as BlobPart], { type: MIME[f.format] }));
  const a = document.createElement("a");
  a.href = url;
  a.download = downloadName(f);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
