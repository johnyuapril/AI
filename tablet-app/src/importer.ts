import JSZip from 'jszip';
import * as CFB from 'cfb';
import { inflateRaw, inflate } from 'pako';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Format, Line, LineType } from './types';
import { uid } from './util';
import { looksLikeHeading, stripSceneNumber, TRANSITION_RE } from './script';
import { parseShotLine } from './shots';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface RawLine { text: string; x?: number; blankBefore?: boolean; side?: [string, string] }

// ---------------- 형식별 글자 꺼내기 ----------------
async function pdfLines(buf: ArrayBuffer): Promise<RawLine[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const out: RawLine[] = [];
  for (let pn = 1; pn <= doc.numPages; pn++) {
    const page = await doc.getPage(pn);
    const tc = await page.getTextContent();
    const items = (tc.items as any[]).filter(it => typeof it.str === 'string' && it.str.trim() !== '' )
      .map(it => ({ s: it.str as string, x: it.transform[4] as number, y: it.transform[5] as number, w: (it.width as number) || 0, h: Math.abs(it.transform[3] as number) || 10 }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: typeof items[] = [];
    for (const it of items) {
      const r = rows[rows.length - 1];
      if (r && Math.abs(r[0].y - it.y) <= Math.max(2, it.h * 0.35)) r.push(it); else rows.push([it]);
    }
    let lastY: number | null = null;
    for (const r of rows) {
      r.sort((a, b) => a.x - b.x);
      let text = ''; let prevEnd = -1; let side: [string, string] | undefined;
      for (let i = 0; i < r.length; i++) {
        const it = r[i];
        if (prevEnd >= 0) {
          const gap = it.x - prevEnd;
          if (gap > it.h * 2.5 && !side && text.trim().length <= 12) { side = [text.trim(), '']; text = ''; }
          else if (gap > it.h * 0.25 && !/\s$/.test(text)) text += ' ';
        }
        text += it.s; prevEnd = it.x + it.w;
      }
      if (side) side[1] = text.trim();
      const full = side ? side[0] + '\t' + side[1] : text.trim();
      if (/^[-–\s]*\d+[-–\s.]*$/.test(full)) continue; // 쪽 번호
      const y = r[0].y; const h = r[0].h;
      out.push({ text: full, x: r[0].x, blankBefore: lastY !== null && lastY - y > h * 1.9, side });
      lastY = y;
    }
    lastY = null;
  }
  return out;
}

function hwpRecordsText(data: Uint8Array): string[] {
  const paras: string[] = [];
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let off = 0;
  while (off + 4 <= data.length) {
    const h = dv.getUint32(off, true); off += 4;
    const tag = h & 0x3ff; let size = (h >>> 20) & 0xfff;
    if (size === 0xfff) { size = dv.getUint32(off, true); off += 4; }
    if (tag === 67) {
      let s = '';
      for (let i = 0; i + 1 < size;) {
        const c = dv.getUint16(off + i, true);
        if (c < 32) {
          if (c === 10) s += '\n';
          else if (c === 9) s += '\t';
          if ([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31].includes(c)) i += 2; else i += 16;
        } else { s += String.fromCharCode(c); i += 2; }
      }
      paras.push(s);
    }
    off += size;
  }
  return paras;
}
async function hwpLines(buf: ArrayBuffer): Promise<RawLine[]> {
  const cfb = CFB.read(new Uint8Array(buf), { type: 'array' });
  const header = CFB.find(cfb, 'FileHeader');
  const flags = header ? new DataView((header.content as any).buffer || new Uint8Array(header.content as any).buffer).getUint32(36, true) : 1;
  const compressed = (flags & 1) === 1;
  const out: RawLine[] = [];
  for (let n = 0; n < 200; n++) {
    const e = CFB.find(cfb, `BodyText/Section${n}`);
    if (!e) break;
    let data = new Uint8Array(e.content as any);
    if (compressed) { try { data = inflateRaw(data); } catch { data = inflate(data); } }
    let blank = false;
    for (const p of hwpRecordsText(data)) {
      for (const seg of p.split('\n')) {
        const t = seg.replace(/\s+$/, '');
        if (!t.trim()) { blank = true; continue; }
        out.push({ text: t.trim(), blankBefore: blank }); blank = false;
      }
    }
  }
  return out;
}
async function xmlParas(xml: string, pTag: string, tTag: string, tabTag: string, brTag: string): Promise<RawLine[]> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out: RawLine[] = []; let blank = false;
  const ps = doc.getElementsByTagName(pTag);
  for (const p of Array.from(ps)) {
    let s = '';
    const walk = (n: Node) => {
      for (const c of Array.from(n.childNodes)) {
        if (c.nodeType !== 1) continue;
        const el = c as Element;
        if (el.tagName === tTag) s += el.textContent || '';
        else if (el.tagName === tabTag) s += '\t';
        else if (el.tagName === brTag) s += '\n';
        else if (el.tagName !== pTag) walk(el);
      }
    };
    walk(p);
    for (const seg of s.split('\n')) {
      if (!seg.trim()) { blank = true; continue; }
      out.push({ text: seg.trim(), blankBefore: blank }); blank = false;
    }
  }
  return out;
}
async function hwpxLines(buf: ArrayBuffer): Promise<RawLine[]> {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter(n => /Contents\/section\d+\.xml$/i.test(n)).sort((a, b) => parseInt(a.match(/(\d+)\.xml/)![1]) - parseInt(b.match(/(\d+)\.xml/)![1]));
  const out: RawLine[] = [];
  for (const n of names) out.push(...await xmlParas(await zip.file(n)!.async('string'), 'hp:p', 'hp:t', 'hp:tab', 'hp:lineBreak'));
  return out;
}
async function docxLines(buf: ArrayBuffer): Promise<RawLine[]> {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('워드 문서 내용을 찾지 못했어요.');
  return xmlParas(xml, 'w:p', 'w:t', 'w:tab', 'w:br');
}
function textLines(t: string): RawLine[] {
  const out: RawLine[] = []; let blank = false;
  for (const raw of t.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) { blank = true; continue; }
    const lead = raw.match(/^[ \t]*/)![0].replace(/\t/g, '    ').length;
    out.push({ text: raw.trim(), x: lead, blankBefore: blank }); blank = false;
  }
  return out;
}

// ---------------- Fountain ----------------
export function parseFountain(src: string): Line[] {
  const rows = src.replace(/\r\n?/g, '\n').split('\n');
  const lines: Line[] = [];
  const push = (t: LineType, text: string, m?: 1) => lines.push({ id: uid(), t, text, ...(m ? { m } : {}) });
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; const t = r.trim();
    if (!t) continue;
    if (/^title:|^author:|^credit:|^draft date:/i.test(t)) continue;
    if (t.startsWith('.') && !t.startsWith('..')) { push('scene', t.slice(1).trim(), 1); continue; }
    if (/^(INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i.test(t)) { push('scene', t); continue; }
    if (t.startsWith('>') && !t.endsWith('<')) { push('transition', t.slice(1).trim(), 1); continue; }
    if (/^[A-Z\s]+TO:$/.test(t)) { push('transition', t); continue; }
    if (t.startsWith('!')) { const s = t.slice(1).trim(); push(parseShotLine(s) && s.startsWith('/') ? 'shot' : 'action', s.replace(/^\//, ''), 1); continue; }
    if (t.startsWith('~')) { push('shot', t.slice(1).trim(), 1); continue; }
    const isChar = t.startsWith('@') || (/^[A-Z0-9 ._\-']+(\s*\(.*\))?$/.test(t) && /[A-Z]/.test(t) && rows[i + 1]?.trim());
    if (isChar && (i === 0 || !rows[i - 1].trim())) {
      push('character', t.replace(/^@/, '').trim(), t.startsWith('@') ? 1 : undefined);
      for (i = i + 1; i < rows.length && rows[i].trim(); i++) {
        const d = rows[i].trim();
        if (/^\(.*\)$/.test(d)) push('paren', d); else push('dialogue', d);
      }
      continue;
    }
    push('action', t);
  }
  return lines;
}

export function toFountain(title: string, lines: Line[]): string {
  const out: string[] = [`Title: ${title}`, ''];
  let prev: LineType | null = null;
  for (const l of lines) {
    if (l.t === 'scene') out.push('', '.' + l.text);
    else if (l.t === 'character') out.push('', '@' + l.text);
    else if (l.t === 'dialogue' || l.t === 'paren') out.push(l.text);
    else if (l.t === 'transition') out.push('', '>' + l.text);
    else if (l.t === 'shot') out.push('', '~' + l.text);
    else out.push(prev === 'action' ? '' : '', '!' + l.text);
    prev = l.t;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

// ---------------- 줄 분류 ----------------
const baseName = (t: string) => t.replace(/\s*[(（][^)）]*[)）]\s*$/, '').trim();
const NAME_COLON = /^([가-힣A-Za-z0-9·\s]{1,12}?)\s*[:：]\s*(.+)$/;

export function classify(raw: RawLine[]): { lines: Line[]; format: Format } {
  const lines: Line[] = [];
  const push = (t: LineType, text: string) => { if (text.trim()) lines.push({ id: uid(), t, text: text.trim() }); };
  // 독립 줄로 2번 이상 나온 짧은 이름 → 인물 후보
  const freq = new Map<string, number>();
  for (const r of raw) {
    const t = r.text.trim();
    if (t.length <= 14 && !/[.!?…,"'“”]$/.test(t) && !looksLikeHeading(t) && !TRANSITION_RE.test(t)) { const b = baseName(t); freq.set(b, (freq.get(b) || 0) + 1); }
    const m = r.text.match(NAME_COLON); if (m && m[1].trim().length <= 8) freq.set('§' + m[1].trim(), (freq.get('§' + m[1].trim()) || 0) + 1);
  }
  const xs = raw.map(r => r.x).filter((x): x is number => x !== undefined);
  const margin = xs.length ? xs.sort((a, b) => a - b)[Math.floor(xs.length * 0.1)] : 0;
  const hasX = xs.length > raw.length * 0.5 && xs[xs.length - 1] - xs[0] > 4;
  let colonCount = 0, sideCount = 0, hollywood = 0;
  let mode: 'none' | 'dlg' = 'none';
  let dlgX = -1;
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]; const t = r.text.trim();
    if (r.blankBefore && mode === 'dlg' && !hasX) mode = 'none';
    if (looksLikeHeading(t) || /^(S\s*#|#)\s*\d+/i.test(t)) {
      if (/^(INT|EXT)/i.test(stripSceneNumber(t))) hollywood++;
      push('scene', stripSceneNumber(t)); mode = 'none'; continue;
    }
    if (TRANSITION_RE.test(t)) { push('transition', t); mode = 'none'; continue; }
    // 나란히형: 이름 [큰 간격] 대사
    const side = r.side || (t.includes('\t') ? t.split(/\t+/, 2) as [string, string] : null);
    if (side && side[0].trim().length <= 10 && side[1] && side[1].trim()) {
      sideCount++; push('character', side[0]);
      const d = side[1].trim();
      if (/^\(.*?\)/.test(d)) { const m = d.match(/^(\(.*?\))\s*(.*)$/)!; push('paren', m[1]); push('dialogue', m[2]); } else push('dialogue', d);
      mode = 'dlg'; dlgX = r.x ?? -1; continue;
    }
    const mc = t.match(NAME_COLON);
    if (mc && (freq.get('§' + mc[1].trim()) || 0) >= 2 && !/[.!?]/.test(mc[1])) {
      colonCount++; push('character', mc[1]);
      const d = mc[2].trim();
      if (/^\(.*?\)/.test(d)) { const m = d.match(/^(\(.*?\))\s*(.*)$/)!; push('paren', m[1]); if (m[2]) push('dialogue', m[2]); } else push('dialogue', d);
      mode = 'dlg'; continue;
    }
    if (/^\(.*\)$/.test(t) && t.length < 50) { push('paren', t); continue; }
    const shot = parseShotLine(t);
    if (shot && t.length < 60 && (shot.shot || shot.angle) ) { push('shot', t); mode = 'none'; continue; }
    const next = raw[i + 1];
    const indented = hasX && r.x !== undefined && r.x > margin + 40;
    const fq = freq.get(baseName(t)) || 0;
    const shortName = baseName(t).length <= 8 && !/\s/.test(baseName(t)) && !/[.!?…,"'“”~다요]$/.test(baseName(t));
    const nameLike = t.length <= 14 && !/[.!?…,"'“”~]$/.test(t) && !!next && (fq >= 2 || (shortName && !hasX && !next.blankBefore && (r.blankBefore || i === 0)));
    if (nameLike && (!hasX || indented || fq >= 3)) {
      push('character', t); mode = 'dlg'; dlgX = next?.x ?? -1; continue;
    }
    if (mode === 'dlg') {
      const contDlg = hasX ? (r.x !== undefined && dlgX >= 0 && Math.abs(r.x - dlgX) < 12 && r.x > margin + 10) : !r.blankBefore;
      if (contDlg) {
        const last = lines[lines.length - 1];
        if (last && last.t === 'dialogue') last.text += ' ' + t; else push('dialogue', t);
        continue;
      }
      mode = 'none';
    }
    // 지문: 같은 문단이면 이어 붙이기
    const last = lines[lines.length - 1];
    if (last && last.t === 'action' && !r.blankBefore && !/[.!?…"”」)]$/.test(last.text)) last.text += ' ' + t;
    else push('action', t);
  }
  if (!lines.length || lines[0].t !== 'scene') {
    if (!lines.length) lines.push({ id: uid(), t: 'scene', text: '' });
  }
  const format: Format = hollywood > 3 ? 'hollywood' : (sideCount + colonCount > 5 ? 'ko-side' : 'ko-stack');
  return { lines, format };
}

export async function importFile(file: File): Promise<{ lines: Line[]; format: Format; title: string }> {
  const name = file.name; const ext = name.split('.').pop()!.toLowerCase();
  const title = name.replace(/\.[^.]+$/, '');
  const buf = await file.arrayBuffer();
  if (ext === 'fountain' || ext === 'spmd') {
    const lines = parseFountain(new TextDecoder().decode(buf));
    return { lines, format: 'ko-stack', title };
  }
  let raw: RawLine[];
  if (ext === 'pdf') raw = await pdfLines(buf);
  else if (ext === 'hwp') raw = await hwpLines(buf);
  else if (ext === 'hwpx') raw = await hwpxLines(buf);
  else if (ext === 'docx') raw = await docxLines(buf);
  else {
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) { try { text = new TextDecoder('euc-kr').decode(buf); } catch { /* ignore */ } }
    if (/^\s*(Title:|\.[^\s.])/m.test(text) && /^\s*[@!.>]/m.test(text)) return { lines: parseFountain(text), format: 'ko-stack', title };
    raw = textLines(text);
  }
  if (!raw.length) throw new Error('글자를 찾지 못했어요. 스캔한 이미지 PDF는 불러올 수 없어요.');
  const r = classify(raw);
  return { ...r, title };
}
