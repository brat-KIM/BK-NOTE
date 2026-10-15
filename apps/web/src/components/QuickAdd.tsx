import { useState, type FormEvent } from 'react';

interface Props {
  onAdd(text: string): Promise<void>;
  inputRef?: React.Ref<HTMLInputElement>;
}

/** 맨 위 빠른 입력창. 엔터로 연달아 여러 개. 여러 줄을 붙이면 줄마다 항목. */
export function QuickAdd({ onAdd, inputRef }: Props) {
  const [text, setText] = useState('');
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    await onAdd(t);
  };
  return (
    <form className="quickadd" onSubmit={submit}>
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text');
          if (pasted.includes('\n')) {
            e.preventDefault();
            void onAdd(pasted);
          }
        }}
        placeholder="＋ 적기…  (예: 내일 3시 세무사 전화 @폰 !5)"
        aria-label="빠른 입력"
        enterKeyHint="done"
      />
    </form>
  );
}
