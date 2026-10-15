// 편집 중이 아닌 항목은 TipTap JSON 을 가볍게 직접 그린다(항목 수백 개여도 편집기는 하나만).
import type { RichDoc, RichNode } from '@bk-note/core';
import type { CSSProperties, ReactNode } from 'react';

export function RichText({ doc }: { doc: RichDoc }) {
  return <>{(doc.content ?? []).map((n, i) => <Block key={i} node={n} />)}</>;
}

function Block({ node }: { node: RichNode }) {
  if (node.type === 'paragraph') {
    return <span className="rt-p">{(node.content ?? []).map((c, i) => <Inline key={i} node={c} />)}</span>;
  }
  return <>{(node.content ?? []).map((c, i) => <Inline key={i} node={c} />)}</>;
}

function Inline({ node }: { node: RichNode }) {
  if (node.type === 'hardBreak') return <br />;
  if (node.type !== 'text') return null;
  let el: ReactNode = node.text ?? '';
  const style: CSSProperties = {};
  for (const m of node.marks ?? []) {
    switch (m.type) {
      case 'bold': el = <strong>{el}</strong>; break;
      case 'italic': el = <em>{el}</em>; break;
      case 'underline': el = <u>{el}</u>; break;
      case 'strike': el = <s>{el}</s>; break;
      case 'code': el = <code>{el}</code>; break;
      case 'highlight': el = <mark style={{ background: String(m.attrs?.color ?? '#fff3a3') }}>{el}</mark>; break;
      case 'textStyle': if (m.attrs?.color) style.color = String(m.attrs.color); break;
      case 'link': {
        const href = String(m.attrs?.href ?? '');
        if (/^https?:\/\//i.test(href)) el = <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{el}</a>;
        break;
      }
    }
  }
  return style.color ? <span style={style}>{el}</span> : <>{el}</>;
}
