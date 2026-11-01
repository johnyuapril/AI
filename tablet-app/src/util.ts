export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function cleanPasted(s: string): string {
  let t = s.replace(/\r\n?/g, '\n');
  t = t.replace(/\\\\n|\\n|\\r/g, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/[↵⏎]/g, '\n');
  t = t.replace(/\s*\\\s*\\\s*/g, '\n');      // "\ \" 같은 줄바꿈 기호
  t = t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  t = t.replace(/^\s*[-*•]\s+(?=\S)/gm, '');
  t = t.replace(/^\s*(-{3,}|_{3,}|\*{3,})\s*$/gm, '');
  t = t.replace(/`{1,3}/g, '');
  const lines = t.split('\n').map(l => l.trim());
  const out: string[] = [];
  for (const l of lines) {
    if (!l) continue;
    const prev = out[out.length - 1];
    const isItem = /^(\[|[0-9]+[-.)]|[가-힣A-Za-z0-9 ]{1,12}\s*[:：])/.test(l);
    if (prev !== undefined && !isItem && !/[.!?。…"'」)\]다요죠]$/.test(prev) && !/^\[/.test(prev)) {
      out[out.length - 1] = prev + ' ' + l;
    } else out.push(l);
  }
  return out.join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fallthrough */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

export function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCSV(rows: unknown[][]): string {
  return '﻿' + rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
}

// 한국어 받침 판별 + 조사 맞추기
export function hasBatchim(word: string): boolean {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return false;
  return (c - 0xac00) % 28 !== 0;
}
const JOSA: [string, string][] = [['은', '는'], ['이', '가'], ['을', '를'], ['과', '와'], ['아', '야'], ['이랑', '랑'], ['으로', '로'], ['이나', '나'], ['이며', '며'], ['이다', '다'], ['이야', '야']];
export function renameInText(text: string, from: string, to: string): string {
  if (!from) return text;
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^가-힣A-Za-z0-9])${esc}(이랑|랑|으로|로|이나|나|이며|며|이야|이다|은|는|이|가|을|를|과|와|아|야|의|에게|한테|도|만|께|에서|에)?(?![가-힣A-Za-z0-9])`, 'g');
  return text.replace(re, (_m, pre: string, josa?: string) => {
    let j = josa || '';
    if (j) {
      for (const [a, b] of JOSA) {
        if (j === a || j === b) { j = hasBatchim(to) ? a : b; break; }
      }
    }
    return pre + to + j;
  });
}
export function countMentions(text: string, name: string): number {
  if (!name) return 0;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^가-힣A-Za-z0-9])${esc}(?=(이랑|랑|으로|로|이나|나|이며|며|이야|이다|은|는|이|가|을|를|과|와|아|야|의|에게|한테|도|만|께|에서|에|[^가-힣A-Za-z0-9]|$))`, 'g');
  return (text.match(re) || []).length;
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
