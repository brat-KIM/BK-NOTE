import { useState } from 'react';
import { useServices } from '../app/services';

/** 이메일 로그인: 링크를 누르거나(웹·폰) 메일의 6자리 코드를 입력(데스크톱 앱). */
export function AuthPanel() {
  const { cloud } = useServices();
  const [email, setEmail] = useState(() => { try { return localStorage.getItem('bk.email') ?? ''; } catch { return ''; } });
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  if (!cloud) return null;
  return (
    <section className="auth">
      <p>동기화하려면 로그인해 줘. 로그인 전에 적은 것도 이 기기에 저장돼 있다가 로그인하면 올라가.</p>
      {!sent ? (
        <form onSubmit={async (e) => {
          e.preventDefault();
          setMsg(null);
          try {
            await cloud.sendLoginEmail(email.trim());
            try { localStorage.setItem('bk.email', email.trim()); } catch { /* 무시 */ }
            setSent(true);
          } catch (err) {
            setMsg(`메일 발송 실패: ${(err as Error).message}`);
          }
        }}>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="이메일" aria-label="이메일" />
          <button type="submit">로그인 메일 받기</button>
        </form>
      ) : (
        <form onSubmit={async (e) => {
          e.preventDefault();
          try {
            await cloud.verifyCode(email.trim(), code.trim());
          } catch (err) {
            setMsg(`코드 확인 실패: ${(err as Error).message}`);
          }
        }}>
          <p>메일 왔을 거야. 링크를 누르거나 6자리 코드를 넣어.</p>
          <input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6자리 코드" aria-label="코드" />
          <button type="submit">확인</button>
          <button type="button" className="link" onClick={() => setSent(false)}>다시 보내기</button>
        </form>
      )}
      {msg && <p className="error">{msg}</p>}
    </section>
  );
}
