import { useState } from 'react';

export function Field({ label, value, onChange, rows = 2, placeholder }: { label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return (
    <label className="field"><span>{label}</span>
      <textarea rows={rows} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </label>
  );
}

/** 한 줄에 하나씩 적는 목록 */
export function LinesField({ label, value, onChange, placeholder }: { label: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(value.join('\n'));
  return (
    <label className="field"><span>{label} <small>(한 줄에 하나)</small></span>
      <textarea rows={Math.min(8, Math.max(2, value.length + 1))} value={text} placeholder={placeholder}
        onChange={e => { setText(e.target.value); onChange(e.target.value.split('\n').map(s => s.trim()).filter(Boolean)); }} />
    </label>
  );
}

/** 두 번 눌러야 동작하는 버튼 (삭제처럼 되돌릴 수 없는 일) */
export function ConfirmButton({ children, onConfirm, className = 'small danger' }: { children: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button className={className} onBlur={() => setArmed(false)} onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>
      {armed ? '한 번 더 누르면 ' + children : children}
    </button>
  );
}

export async function copyText(t: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(t); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
