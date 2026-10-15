import { useLiveQuery } from 'dexie-react-hooks';
import { useServices } from '../app/services';
import { RichText } from '../editor/RichText';

export function TrashView() {
  const { store, db } = useServices();
  const items = useLiveQuery(() => store.trashItems(), [db]);
  return (
    <section className="trash">
      <h2>🗑 휴지통 <small>30일 보관 후 자동 삭제</small></h2>
      {!items?.length && <p className="empty">비어 있어.</p>}
      <ul className="items">
        {items?.map((it) => (
          <li key={it.id} className="item trashed">
            <div className="body"><div className="rt"><RichText doc={it.content} /></div></div>
            <button className="chip" onClick={() => void store.restore(it.id)}>되돌리기</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
