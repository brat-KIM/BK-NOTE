import type { Editor } from '@tiptap/react';
import { useEffect, useReducer } from 'react';
import { cycleColor } from '../editor/ItemEditor';
import { HIGHLIGHTS, TEXT_COLORS } from '../editor/marks';

/** 편집 중일 때 뜨는 서식 툴바(마우스·폰용). 단축키와 같은 동작. */
export function FormatBar({ editor }: { editor: Editor | null }) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on('transaction', force);
    return () => void editor.off('transaction', force);
  }, [editor]);
  if (!editor) return null;
  const btn = (label: string, title: string, active: boolean, run: () => void, cls = '') => (
    <button
      type="button"
      className={`fb ${cls}${active ? ' on' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => {
        e.preventDefault();
        run();
      }}
    >
      {label}
    </button>
  );
  const ch = () => editor.chain().focus();
  return (
    <div className="formatbar" role="toolbar" aria-label="서식">
      {btn('B', '굵게 (Ctrl+B)', editor.isActive('bold'), () => ch().toggleBold().run(), 'b')}
      {btn('I', '기울임 (Ctrl+I)', editor.isActive('italic'), () => ch().toggleItalic().run(), 'i')}
      {btn('U', '밑줄 (Ctrl+U)', editor.isActive('underline'), () => ch().toggleUnderline().run(), 'u')}
      {btn('S', '취소선 (Ctrl+-)', editor.isActive('strike'), () => ch().toggleStrike().run(), 's')}
      <span className="sep" />
      {HIGHLIGHTS.map((c) => (
        <button
          key={c}
          type="button"
          className={`dot${editor.isActive('highlight', { color: c }) ? ' on' : ''}`}
          style={{ background: c }}
          title="형광펜 (Ctrl+Alt+H)"
          aria-label={`형광펜 ${c}`}
          onMouseDown={(e) => {
            e.preventDefault();
            if (editor.isActive('highlight', { color: c })) ch().unsetHighlight().run();
            else ch().setHighlight({ color: c }).run();
          }}
        />
      ))}
      <span className="sep" />
      {btn('A', '글자색 (Ctrl+Shift+C)', !!editor.getAttributes('textStyle').color, () => cycleColor(editor), 'color')}
      <span className="color-preview" style={{ background: (editor.getAttributes('textStyle').color as string) ?? TEXT_COLORS[0] }} />
      {btn('⌫', '서식 지우기 (Ctrl+Space)', false, () => ch().unsetAllMarks().run())}
    </div>
  );
}
