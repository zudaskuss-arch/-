import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="auth-root">
        <style>{authStyles}</style>
        <div className="auth-loading">불러오는 중...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="auth-root">
        <style>{authStyles}</style>
        <LoginForm />
      </div>
    );
  }

  return children;
}

// Supabase Auth is email-based under the hood, but we let people sign up with
// a plain username. A real email (contains "@") is used as-is; a bare
// username is turned into a stable pseudo-email so login can reproduce it.
const USERNAME_DOMAIN = "vocab.local";

function toAuthEmail(rawInput) {
  const trimmed = rawInput.trim();
  if (trimmed.includes("@")) return trimmed.toLowerCase();
  const normalized = trimmed.toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return `${normalized}@${USERNAME_DOMAIN}`;
}

function LoginForm() {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");
    const email = toAuthEmail(identifier);
    if (email === `@${USERNAME_DOMAIN}`) {
      setError("아이디를 입력해주세요 (영문/숫자).");
      return;
    }
    setLoading(true);
    try {
      if (mode === "login") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      } else {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        if (!data.session) {
          setNotice("가입 확인 이메일을 보냈어요. 메일함을 확인해주세요. (아이디로 가입했다면 관리자가 이메일 인증을 꺼둔 경우 바로 로그인돼요)");
        }
      }
    } catch (err) {
      setError(translateAuthError(err.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-card">
      <div className="auth-kicker">Personal English Notebook</div>
      <h1 className="auth-title">나만의 단어장</h1>
      <p className="auth-sub">{mode === "login" ? "로그인하고 이어서 공부하세요" : "새 계정을 만들어보세요"}</p>

      <div className="auth-tabs">
        <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); setNotice(""); }}>로그인</button>
        <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); setNotice(""); }}>회원가입</button>
      </div>

      <form onSubmit={submit}>
        <div className="auth-field">
          <label>아이디 또는 이메일</label>
          <input type="text" required minLength={3} value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="영문/숫자 아이디 또는 you@example.com" />
        </div>
        <div className="auth-field">
          <label>비밀번호</label>
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6자 이상" />
        </div>

        {error && <div className="auth-error">{error}</div>}
        {notice && <div className="auth-notice">{notice}</div>}

        <button type="submit" className="auth-submit" disabled={loading}>
          {loading ? "처리 중..." : mode === "login" ? "로그인" : "회원가입"}
        </button>
      </form>
    </div>
  );
}

function translateAuthError(msg = "") {
  if (msg.includes("Invalid login credentials")) return "아이디/이메일 또는 비밀번호가 올바르지 않아요.";
  if (msg.includes("User already registered")) return "이미 가입된 아이디예요. 로그인해주세요.";
  if (msg.includes("Password should be at least")) return "비밀번호는 6자 이상이어야 해요.";
  if (msg.includes("Unable to validate email address")) return "아이디는 영문/숫자로 입력해주세요.";
  return msg || "문제가 발생했어요. 다시 시도해주세요.";
}

const authStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap');
  .auth-root {
    font-family: 'Apple SD Gothic Neo', -apple-system, BlinkMacSystemFont, 'Noto Sans KR', 'Malgun Gothic', sans-serif;
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #F4F8FC; padding: 20px; box-sizing: border-box;
  }
  .auth-root *{box-sizing:border-box;}
  .auth-loading { color: #868FA0; font-weight: 600; }
  .auth-card {
    background: #fff; border-radius: 22px; padding: 32px 26px; width: 100%; max-width: 380px;
    box-shadow: 0 10px 26px rgba(80,100,140,0.10); border: 1.5px solid #E7ECF3;
  }
  .auth-kicker { font-size: 11px; letter-spacing: 0.14em; color: #3E6EA5; text-transform: uppercase; font-weight: 700; opacity: 0.75; text-align: center; }
  .auth-title { font-size: 26px; color: #3E6EA5; margin: 6px 0 4px; font-weight: 900; text-align: center; }
  .auth-sub { font-size: 13px; color: #868FA0; margin: 0 0 20px; font-weight: 500; text-align: center; }
  .auth-tabs { display: flex; gap: 6px; background: #F4F8FC; border-radius: 12px; padding: 4px; margin-bottom: 18px; }
  .auth-tabs button { flex: 1; padding: 9px; border: none; border-radius: 9px; background: none; color: #868FA0; font-weight: 800; font-size: 13px; cursor: pointer; }
  .auth-tabs button.active { background: #fff; color: #3E6EA5; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .auth-field { margin-bottom: 14px; }
  .auth-field label { display: block; font-size: 12px; font-weight: 800; color: #868FA0; margin-bottom: 5px; }
  .auth-field input { width: 100%; padding: 11px 12px; border: 1.5px solid #E7ECF3; border-radius: 10px; font-size: 14.5px; }
  .auth-field input:focus { outline: none; border-color: #8FB8E8; }
  .auth-error { color: #BE5548; background: #FDEDEB; padding: 8px 10px; border-radius: 10px; font-size: 12.5px; font-weight: 600; margin-bottom: 12px; }
  .auth-notice { color: #3E7A56; background: #E9F8EE; padding: 8px 10px; border-radius: 10px; font-size: 12.5px; font-weight: 600; margin-bottom: 12px; }
  .auth-submit { width: 100%; padding: 12px; border: none; border-radius: 12px; background: #F7C873; color: #5B4415; font-weight: 800; font-size: 14.5px; cursor: pointer; }
  .auth-submit:disabled { opacity: 0.6; cursor: not-allowed; }
`;
