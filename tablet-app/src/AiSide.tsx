import { useEffect, useState } from 'react';
import { AI_APPS, onPreferredAi, openAiSide, preferredAi, setPreferredAi } from './native';

/** 옆 화면에 열 AI 고르기: ChatGPT / Claude. 누르면 그 AI를 옆 화면에 열고, 다음부터 쓰는 AI로 기억 */
const SIDE_AIS = AI_APPS.filter(a => a.id === 'chatgpt' || a.id === 'claude');

export default function AiSideButtons() {
  const [cur, setCur] = useState(preferredAi);
  useEffect(() => onPreferredAi(setCur), []);
  return <span className="aipick" title="AI 옆 화면에 열기">
    <span className="muted small-t">AI 옆 화면에 열기</span>
    {SIDE_AIS.map(a => <button key={a.id} className={cur === a.id ? 'on' : ''}
      onClick={() => { setPreferredAi(a.id); setCur(a.id); openAiSide(a.id); }}>{a.name} ◫</button>)}
  </span>;
}

/** 쓰는 AI만 고르기 (열지는 않음). 한 번 고르면 바꿀 때까지 기억 */
export function AiPicker() {
  const [cur, setCur] = useState(preferredAi);
  useEffect(() => onPreferredAi(setCur), []);
  return <span className="aipick">
    <span className="muted small-t">쓰는 AI</span>
    {SIDE_AIS.map(a => <button key={a.id} className={cur === a.id ? 'on' : ''} onClick={() => { setPreferredAi(a.id); setCur(a.id); }}>{a.name}</button>)}
  </span>;
}
