/**
 * 會員登入／註冊頁。
 *
 * 單頁四種模式（以網址參數切換，支援深層連結）：
 *   /auth                      登入
 *   /auth?mode=signup          註冊（註冊需收取確認信完成驗證）
 *   /auth?mode=forgot          忘記密碼（寄送重設信）
 *   /auth?mode=reset-password  密碼重設連結的落點（點信中連結後由本頁設定新密碼）
 * Supabase 未配置時整頁顯示會員功能未啟用的說明。
 */
import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  clearRecoveryScreen,
  requestPasswordReset,
  signIn,
  signUp,
  updatePassword,
  useAuth,
} from '../lib/authStore';

/** 登入頁的四種表單模式。 */
type AuthFormMode = 'signin' | 'signup' | 'forgot' | 'reset-password';

/** 資料庫設定的密碼最小長度。 */
const PASSWORD_MIN_LENGTH = 6;

/** 通用樣式字串（延用全站霓虹夜色語彙）。 */
const INPUT_CLASS =
  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-ink placeholder:text-ink-muted/60 focus:border-neon-purple/70 focus:outline-none';
const LABEL_CLASS = 'mt-4 block text-xs font-semibold tracking-wide text-ink-muted';
const SUBMIT_CLASS =
  'mt-6 w-full rounded-full border border-neon-purple/60 bg-neon-purple/25 px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-neon-purple/40 disabled:opacity-50';
const ERROR_CLASS = 'mt-4 rounded-lg border border-neon-pink/40 bg-neon-pink/10 px-3 py-2 text-sm text-ink';
const NOTICE_CLASS = 'mt-4 rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 px-3 py-2 text-sm text-ink';

/** Email 的基本格式檢查。 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 依網址參數解析表單模式，不合法的值一律退回登入模式。
 *
 * @param value 網址參數 mode 的原始字串
 */
function readMode(value: string | null): AuthFormMode {
  if (value === 'signup' || value === 'forgot' || value === 'reset-password') return value;
  return 'signin';
}

/**
 * 驗證 Email 欄位，通過時回傳 null。
 *
 * @param email 使用者輸入的信箱
 */
function validateEmail(email: string): string | null {
  if (email.trim() === '') return '請輸入 Email。';
  if (!EMAIL_PATTERN.test(email.trim())) return 'Email 格式不正確，請確認後再輸入。';
  return null;
}

/**
 * 驗證密碼欄位，通過時回傳 null。
 *
 * @param password 使用者輸入的密碼
 */
function validatePassword(password: string): string | null {
  if (password.length === 0) return '請輸入密碼。';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `密碼至少需要 ${PASSWORD_MIN_LENGTH} 個字元。`;
  }
  return null;
}

/**
 * 驗證顯示名稱欄位，通過時回傳 null。
 *
 * @param name 使用者輸入的顯示名稱
 */
function validateDisplayName(name: string): string | null {
  if (name.trim() === '') return '請輸入顯示名稱。';
  return null;
}

/** 欄位共用元件的參數。 */
interface FieldProps {
  /** 欄位 id 與對應 label 的 htmlFor。 */
  id: string;
  /** 欄位標籤文字。 */
  label: string;
  /** input 的 type。 */
  type: 'email' | 'password' | 'text';
  /** 目前值。 */
  value: string;
  /** 變更時的回呼（接收去除首尾空白前的原始值）。 */
  onChange: (value: string) => void;
  /** 輸入框的佔位文字。 */
  placeholder: string;
  /** 瀏覽器自動填入的用途提示。 */
  autoComplete: string;
  /** 是否必填（預設必填）。 */
  required?: boolean;
}

/**
 * 單列文字欄位（label + input）。
 *
 * @param props 欄位參數
 */
function Field(props: FieldProps) {
  return (
    <>
      <label htmlFor={props.id} className={LABEL_CLASS}>
        {props.label}
      </label>
      <input
        id={props.id}
        type={props.type}
        className={`${INPUT_CLASS} mt-1.5`}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
        required={props.required ?? true}
      />
    </>
  );
}

/** 登入表單。 */
function SignInForm() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const message = validateEmail(email) ?? validatePassword(password);
    if (message) {
      setError(message);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      navigate('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登入失敗，請稍後再試。');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <Field id="signin-email" label="Email" type="email" value={email} onChange={setEmail}
        placeholder="you@example.com" autoComplete="email" />
      <Field id="signin-password" label="密碼" type="password" value={password} onChange={setPassword}
        placeholder="請輸入密碼" autoComplete="current-password" />
      {error ? <p className={ERROR_CLASS} role="alert">{error}</p> : null}
      <button type="submit" className={SUBMIT_CLASS} disabled={submitting}>
        {submitting ? '登入中…' : '登入'}
      </button>
      <div className="mt-5 flex items-center justify-between text-xs text-ink-muted">
        <Link to="/auth?mode=signup" className="hover:text-ink">沒有帳號？註冊</Link>
        <Link to="/auth?mode=forgot" className="hover:text-ink">忘記密碼？</Link>
      </div>
    </form>
  );
}

/** 註冊表單。 */
function SignUpForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const message =
      validateDisplayName(name) ?? validateEmail(email) ?? validatePassword(password);
    if (message) {
      setError(message);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await signUp(email.trim(), password, name.trim());
      if (result.emailConfirmationRequired) setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '註冊失敗，請稍後再試。');
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div>
        <p className={NOTICE_CLASS}>
          確認信已寄出，請收信完成驗證。驗證完成後回到本頁登入即可。
        </p>
        <Link to="/auth" className={
          'mt-6 block rounded-full border border-neon-purple/60 bg-neon-purple/25 px-5 py-2.5 text-center text-sm font-semibold text-ink transition hover:bg-neon-purple/40 no-underline'
        }>
          返回登入
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <Field id="signup-name" label="顯示名稱" type="text" value={name} onChange={setName}
        placeholder="酒單會顯示的名稱" autoComplete="nickname" />
      <Field id="signup-email" label="Email" type="email" value={email} onChange={setEmail}
        placeholder="you@example.com" autoComplete="email" />
      <Field id="signup-password" label="密碼" type="password" value={password} onChange={setPassword}
        placeholder={`至少 ${PASSWORD_MIN_LENGTH} 個字元`} autoComplete="new-password" />
      {error ? <p className={ERROR_CLASS} role="alert">{error}</p> : null}
      <button type="submit" className={SUBMIT_CLASS} disabled={submitting}>
        {submitting ? '註冊中…' : '註冊'}
      </button>
      <div className="mt-5 text-xs text-ink-muted">
        <Link to="/auth" className="hover:text-ink">已經有帳號？登入</Link>
      </div>
    </form>
  );
}

/** 忘記密碼（寄送重設信）。 */
function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const message = validateEmail(email);
    if (message) {
      setError(message);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '寄送失敗，請稍後再試。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <Field id="forgot-email" label="註冊信箱" type="email" value={email} onChange={setEmail}
        placeholder="you@example.com" autoComplete="email" />
      {error ? <p className={ERROR_CLASS} role="alert">{error}</p> : null}
      {sent ? <p className={NOTICE_CLASS}>重設信已寄出，請收信依指示設定新密碼。</p> : null}
      <button type="submit" className={SUBMIT_CLASS} disabled={submitting}>
        {submitting ? '寄送中…' : '寄送重設信'}
      </button>
      <div className="mt-5 text-xs text-ink-muted">
        <Link to="/auth" className="hover:text-ink">返回登入</Link>
      </div>
    </form>
  );
}

/** 設定新密碼表單（由密碼重設連結登入後顯示）。 */
function NewPasswordForm() {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const message = validatePassword(password);
    if (message) {
      setError(message);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await updatePassword(password);
      clearRecoveryScreen();
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '設定失敗，請稍後再試。');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div>
        <p className={NOTICE_CLASS}>新密碼已設定完成，之後請以新密碼登入。</p>
        <Link to="/" className={
          'mt-6 block rounded-full border border-neon-purple/60 bg-neon-purple/25 px-5 py-2.5 text-center text-sm font-semibold text-ink transition hover:bg-neon-purple/40 no-underline'
        }>
          回到首頁
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <Field id="reset-password" label="新密碼" type="password" value={password} onChange={setPassword}
        placeholder={`至少 ${PASSWORD_MIN_LENGTH} 個字元`} autoComplete="new-password" />
      {error ? <p className={ERROR_CLASS} role="alert">{error}</p> : null}
      <button type="submit" className={SUBMIT_CLASS} disabled={submitting}>
        {submitting ? '設定中…' : '設定新密碼'}
      </button>
    </form>
  );
}

/** 密碼重設連結落點的畫面：依登入狀態與 recovery 標記分流。 */
function ResetPasswordPanel() {
  const { status, screen } = useAuth();

  if (status === 'initializing') {
    return (
      <AuthPanel title="設定新密碼">
        <p className={NOTICE_CLASS}>會員狀態讀取中，請稍候……</p>
      </AuthPanel>
    );
  }
  if (status === 'signedIn' && screen === 'recovery') {
    return (
      <AuthPanel title="設定新密碼">
        <NewPasswordForm />
      </AuthPanel>
    );
  }
  return (
    <AuthPanel title="設定新密碼">
      <p className={NOTICE_CLASS}>
        重設連結無效或已過期，請重新申請密碼重設信。
      </p>
      <Link to="/auth?mode=forgot" className="mt-5 text-xs text-ink-muted hover:text-ink no-underline">
        重新申請密碼重設
      </Link>
    </AuthPanel>
  );
}

/**
 * 會員登入／註冊頁。
 */
export function Auth() {
  const [searchParams] = useSearchParams();
  const { available, status } = useAuth();
  const mode = readMode(searchParams.get('mode'));

  if (!available) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 sm:px-6">
        <div className="panel max-w-md p-8 text-center">
          <h1 className="neon-text font-display text-2xl font-black">會員功能尚未啟用</h1>
          <p className="mt-3 text-sm text-ink-muted">
            這個部署未配置會員服務，登入功能暫不開放，配方的瀏覽與手邊材料仍可正常使用。
          </p>
          <Link to="/" className="mt-6 inline-block rounded-full border border-neon-purple/60 bg-neon-purple/15 px-5 py-2 text-sm font-semibold text-ink transition hover:bg-neon-purple/25 no-underline">
            回到首頁
          </Link>
        </div>
      </div>
    );
  }

  if (mode === 'forgot') {
    return (
      <AuthPanel title="忘記密碼">
        <ForgotPasswordForm />
      </AuthPanel>
    );
  }

  if (mode === 'reset-password') {
    return <ResetPasswordPanel />;
  }

  return (
    <AuthPanel title={mode === 'signup' ? '建立帳號' : '歡迎回來'}>
      {status === 'initializing' ? (
        <p className={NOTICE_CLASS}>會員狀態讀取中，請稍候……</p>
      ) : mode === 'signup' ? (
        <SignUpForm />
      ) : (
        <SignInForm />
      )}
    </AuthPanel>
  );
}

/** 登入頁面板容器的參數。 */
interface AuthPanelProps {
  /** 面板標題。 */
  title: string;
  /** 面板內容。 */
  children: ReactNode;
}

/**
 * 登入頁共用的置中面板。
 *
 * @param props 面板參數
 */
function AuthPanel({ title, children }: AuthPanelProps) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16 sm:px-6">
      <div className="panel w-full max-w-md p-6 sm:p-8">
        <h1 className="neon-text font-display text-2xl font-black sm:text-3xl">{title}</h1>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}
