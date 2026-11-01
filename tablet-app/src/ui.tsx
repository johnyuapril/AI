import React, { createContext, useContext, useEffect, useState } from 'react';
import { imageUrl } from './store';

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 2600); return () => clearTimeout(t); }, [msg]);
  return <ToastCtx.Provider value={setMsg}>{children}{msg && <div className="toast">{msg}</div>}</ToastCtx.Provider>;
}

export function Modal({ title, onClose, children, wide, actions }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; actions?: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (wide ? ' wide' : '')}>
        <div className="modal-h"><h3>{title}</h3>{actions}<button onClick={onClose}>닫기</button></div>
        <div className="modal-b">{children}</div>
      </div>
    </div>
  );
}

export function useImageUrl(id?: string) {
  const [u, setU] = useState<string | undefined>();
  useEffect(() => { let on = true; setU(undefined); imageUrl(id).then(x => { if (on) setU(x); }); return () => { on = false; }; }, [id]);
  return u;
}
export function Img({ id, alt = '', onClick, style }: { id?: string; alt?: string; onClick?: () => void; style?: React.CSSProperties }) {
  const u = useImageUrl(id);
  if (!u) return null;
  return <img src={u} alt={alt} onClick={onClick} style={style} draggable={false} />;
}
export function Lightbox({ id, onClose, title }: { id: string; onClose: () => void; title?: string }) {
  return <Modal title={title || '크게 보기'} onClose={onClose} wide><div className="lightbox"><Img id={id} /></div></Modal>;
}

/** 자동 저장되는 textarea: 포커스를 잃을 때 저장 */
export function LazyText({ value, placeholder, onSave, className, style, rows }: { value: string; placeholder?: string; onSave: (v: string) => void; className?: string; style?: React.CSSProperties; rows?: number }) {
  const [v, setV] = useState(value);
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setV(value); }, [value, focus]);
  return <textarea className={className} style={style} rows={rows} value={v} placeholder={placeholder}
    onFocus={() => setFocus(true)}
    onChange={e => setV(e.target.value)}
    onBlur={() => { setFocus(false); if (v !== value) onSave(v); }} />;
}
