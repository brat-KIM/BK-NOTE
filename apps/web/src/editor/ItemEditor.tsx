import { Extension } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { RichDoc } from '@bk-note/core';
import { useEffect, useRef } from 'react';
import { HIGHLIGHTS, TEXT_COLORS, nextInCycle } from './marks';

export interface ItemKeyHandlers {
  onEnter(textAfterCursor: RichDoc | null): void;
  onIndent(): void;
  onOutdent(): void;
  onToggleDone(): void;
  onMoveUp(): void;
  onMoveDown(): void;
  onDeleteEmpty(): void;
  onFocusPrev(): void;
  onFocusNext(): void;
  onEscape(): void;
}

/** 항목 단위 키(엔터=새 항목, Tab=메모, Ctrl+Enter=완료 …) + OneNote 서식 단축키 */
function itemKeys(handlers: { current: ItemKeyHandlers }) {
  return Extension.create({
    name: 'bkItemKeys',
    addKeyboardShortcuts() {
      const h = () => handlers.current;
      const editor = () => this.editor;
      return {
        Enter: () => {
          const ed = editor();
          const { state } = ed;
          const end = state.doc.content.size - 1;
          const from = state.selection.from;
          // 커서 뒤 내용은 새 항목으로 넘긴다(OneNote 줄 나누기와 같은 감각)
          let rest: RichDoc | null = null;
          if (from < end) {
            const slice = state.doc.slice(from, end);
            rest = { type: 'doc', content: [{ type: 'paragraph', content: slice.content.toJSON() ?? [] }] };
            ed.chain().deleteRange({ from, to: end }).run();
          }
          h().onEnter(rest);
          return true;
        },
        'Shift-Enter': () => editor().commands.setHardBreak(),
        Tab: () => (h().onIndent(), true),
        'Shift-Tab': () => (h().onOutdent(), true),
        'Mod-Enter': () => (h().onToggleDone(), true),
        'Mod-1': () => (h().onToggleDone(), true),
        'Alt-ArrowUp': () => (h().onMoveUp(), true),
        'Alt-ArrowDown': () => (h().onMoveDown(), true),
        Escape: () => (h().onEscape(), true),
        Backspace: () => {
          if (editor().isEmpty) {
            h().onDeleteEmpty();
            return true;
          }
          return false;
        },
        ArrowUp: () => {
          if (editor().state.selection.from <= 1) {
            h().onFocusPrev();
            return true;
          }
          return false;
        },
        ArrowDown: () => {
          if (editor().state.selection.to >= editor().state.doc.content.size - 1) {
            h().onFocusNext();
            return true;
          }
          return false;
        },
        // OneNote 단축키
        'Mod--': () => editor().commands.toggleStrike(),
        'Mod-Alt-h': () => cycleHighlight(editor()),
        'Mod-Shift-c': () => cycleColor(editor()),
        'Mod-Space': () => editor().chain().focus().unsetAllMarks().run(),
      };
    },
  });
}

export function cycleHighlight(ed: Editor) {
  const cur = ed.getAttributes('highlight').color as string | undefined;
  const next = ed.isActive('highlight') ? nextInCycle(HIGHLIGHTS, cur) : HIGHLIGHTS[0];
  return next ? ed.chain().focus().setHighlight({ color: next }).run() : ed.chain().focus().unsetHighlight().run();
}

export function cycleColor(ed: Editor) {
  const cur = ed.getAttributes('textStyle').color as string | undefined;
  const next = nextInCycle(TEXT_COLORS, cur);
  return next ? ed.chain().focus().setColor(next).run() : ed.chain().focus().unsetColor().run();
}

interface Props {
  content: RichDoc;
  /** 커서 위치: 'end' | 'start' */
  caret?: 'start' | 'end';
  placeholder?: string;
  handlers: ItemKeyHandlers;
  onChange(doc: RichDoc): void;
  onBlur(doc: RichDoc): void;
  onEditor?(ed: Editor | null): void;
}

export function ItemEditor({ content, caret = 'end', handlers, onChange, onBlur, onEditor }: Props) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const blurRef = useRef(onBlur);
  blurRef.current = onBlur;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true },
      }),
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      itemKeys(handlersRef),
    ],
    content,
    autofocus: caret,
    onUpdate: ({ editor: ed }) => changeRef.current(ed.getJSON() as RichDoc),
    onBlur: ({ editor: ed }) => blurRef.current(ed.getJSON() as RichDoc),
    editorProps: { attributes: { class: 'item-editor', 'aria-label': '항목 편집' } },
  });

  useEffect(() => {
    onEditor?.(editor);
    // React StrictMode 에서 편집기가 다시 만들어지면 autofocus 가 빠지므로 직접 포커스한다
    if (editor && !editor.isFocused) editor.commands.focus(caret);
    return () => onEditor?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, onEditor]);

  return <EditorContent editor={editor} />;
}
