import { useState, type FormEvent } from 'react';

interface Props {
  onAdd(text: string): Promise<void>;
  inputRef?: React.Ref<HTMLInputElement>;
  /** 덩어리 붙여넣기를 AI 나누기로 가져가면 true */
  onPasteBlob?(text: string): boolean;
}

/** 맨 위 빠른 입력창. 엔터로 연달아 여러 개. 여러 줄을 붙이면 줄마다 항목. */
export function QuickAdd({ onAdd, inputRef, onPasteBlob }: Props) {
  const [text, setText] = useState('');
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    await onAdd(t);
  };
  const [listening, setListening] = useState(false);
  const Speech = typeof window !== 'undefined'
    ? ((window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: SpeechCtor }).webkitSpeechRecognition)
    : undefined;
  const listen = () => {
    if (!Speech) return;
    const rec = new Speech();
    rec.lang = 'ko-KR';
    rec.interimResults = false;
    rec.onresult = (e) => {
      const said = e.results[0]?.[0]?.transcript ?? '';
      setText((t) => (t ? `${t} ${said}` : said));
    };
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  };
  return (
    <form className="quickadd" onSubmit={submit}>
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text');
          if (onPasteBlob?.(pasted)) {
            e.preventDefault();
            return;
          }
          if (pasted.includes('\n')) {
            e.preventDefault();
            void onAdd(pasted);
          }
        }}
        placeholder="＋ 적기…  (예: 내일 3시 세무사 전화 @폰 !5)"
        aria-label="빠른 입력"
        enterKeyHint="done"
      />
      {Speech && (
        <button type="button" className={`mic${listening ? ' on' : ''}`} aria-label="말로 적기" onClick={listen}>🎙</button>
      )}
    </form>
  );
}

interface SpeechCtor {
  new (): {
    lang: string;
    interimResults: boolean;
    onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
    onend: () => void;
    start(): void;
  };
}
