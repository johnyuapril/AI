import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import type { Project } from './types';
import { getScenes } from './script';
import { saveFile } from './native';

export async function pagesToPdf(pages: HTMLElement[], landscape: boolean): Promise<Blob> {
  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const W = landscape ? 297 : 210, H = landscape ? 210 : 297;
  for (let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    if (i > 0) pdf.addPage('a4', landscape ? 'landscape' : 'portrait');
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, W, H);
  }
  return pdf.output('blob');
}

const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

/** 대본 PDF: 화면 밖에서 A4 쪽으로 나눠 그린 뒤 그림으로 찍어 PDF로 */
export async function exportScriptPdf(p: Project): Promise<string> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;';
  document.body.appendChild(host);
  const fmt = p.format;
  const serif = fmt === 'ko-side' ? "'Noto Serif KR', serif" : fmt === 'hollywood' ? "'Courier New', monospace" : "'Noto Sans KR', sans-serif";
  const mkPage = () => {
    const d = document.createElement('div');
    d.style.cssText = `width:794px;height:1123px;padding:90px 80px 80px 100px;box-sizing:border-box;background:#fff;color:#000;font-family:${serif};font-size:14px;line-height:1.65;position:relative;overflow:hidden;`;
    const body = document.createElement('div'); body.style.cssText = 'height:100%;overflow:hidden;';
    d.appendChild(body); host.appendChild(d); return { d, body };
  };
  const pages: { d: HTMLDivElement; body: HTMLDivElement }[] = [];
  let cur = mkPage(); pages.push(cur);
  // 표지
  cur.body.innerHTML = `<div style="text-align:center;margin-top:340px;font-size:30px;font-weight:700">${esc(p.title)}</div>${p.team ? `<div style="text-align:center;margin-top:20px">${esc(p.team)}</div>` : ''}`;
  cur = mkPage(); pages.push(cur);
  const scenes = getScenes(p.lines); const num = new Map(scenes.map(s => [s.id, s.num]));
  const blocks: string[] = [];
  for (let i = 0; i < p.lines.length; i++) {
    const l = p.lines[i]; const t = esc(l.text).replace(/\n/g, '<br>');
    if (l.t === 'scene') blocks.push(`<div style="font-weight:700;margin-top:18px">${num.get(l.id)}. ${fmt === 'hollywood' ? t.toUpperCase() : t}</div>`);
    else if (l.t === 'action') blocks.push(`<div style="margin-top:6px">${t}</div>`);
    else if (l.t === 'shot') blocks.push(`<div style="margin-top:6px;font-weight:700">${t}</div>`);
    else if (l.t === 'transition') blocks.push(`<div style="margin-top:6px;text-align:right">${t}</div>`);
    else if (l.t === 'character') {
      const parts: string[] = []; let j = i + 1;
      for (; j < p.lines.length && (p.lines[j].t === 'dialogue' || p.lines[j].t === 'paren'); j++) parts.push(esc(p.lines[j].text).replace(/\n/g, '<br>'));
      i = j - 1;
      if (fmt === 'ko-side') blocks.push(`<div style="display:flex;margin-top:6px"><div style="width:90px;flex-shrink:0">${t}</div><div>${parts.join('<br>')}</div></div>`);
      else if (fmt === 'hollywood') blocks.push(`<div style="margin-top:10px"><div style="padding-left:38%">${t.toUpperCase()}</div><div style="padding:0 22% 0 17%">${parts.join('<br>')}</div></div>`);
      else blocks.push(`<div style="margin-top:10px"><div style="padding-left:40%">${t}</div><div style="padding:0 10% 0 18%">${parts.join('<br>')}</div></div>`);
    } else blocks.push(`<div style="padding-left:20%">${t}</div>`);
  }
  for (const b of blocks) {
    cur.body.insertAdjacentHTML('beforeend', b);
    if (cur.body.scrollHeight > cur.body.clientHeight) {
      const last = cur.body.lastElementChild!; last.remove();
      cur = mkPage(); pages.push(cur); cur.body.insertAdjacentHTML('beforeend', b);
    }
  }
  pages.forEach((pg, i) => { if (i > 0) pg.d.insertAdjacentHTML('beforeend', `<div style="position:absolute;top:40px;right:80px;font-size:12px">${i}.</div>`); });
  try {
    const blob = await pagesToPdf(pages.map(x => x.d), false);
    return await saveFile(blob, `${p.title}.pdf`);
  } finally { host.remove(); }
}
