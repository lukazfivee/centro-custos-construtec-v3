// Regras puras das telas de entrada (sem DOM, testadas por test/mobile-auth-rules.test.js).
(function (root) {
  const PIN_LENGTH = 6;
  const MAX_ATTEMPTS = 3;
  const RESEND_SECONDS = 60;
  const AUTO_LOCK = [
    { label: 'Na hora', seconds: 0 },
    { label: '1 min', seconds: 60 },
    { label: '5 min', seconds: 300 },
    { label: '15 min', seconds: 900 },
  ];
  const AUTO_LOCK_DEFAULT = 300;

  const MSG = {
    emailEmpty: 'Digite seu e-mail.',
    emailInvalid: 'Esse e-mail não parece válido.',
    passwordEmpty: 'Digite sua senha para entrar.',
    pinWeak: 'Evite números repetidos ou em sequência.',
    pinMismatch: 'Os PINs não conferem. Crie de novo.',
    passwordWeak: 'A senha ainda está fraca. Siga a lista acima.',
    passwordMismatch: 'As duas senhas não são iguais.',
  };

  const CODE_MESSAGES = {
    INVALID_CREDENTIALS: 'E-mail ou senha incorretos.',
    ACCOUNT_LEGACY: 'Conta precisa ser reativada pelo administrador.',
    OFFLINE: 'Sem internet. Entre com o PIN ou tente de novo quando conectar.',
    TOKEN_INVALID: 'Este link já foi usado ou não é válido. Peça um novo.',
    TOKEN_EXPIRED: 'Este link expirou. Peça um novo.',
    WEAK_PASSWORD: MSG.passwordWeak,
    RATE_LIMITED: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    NOT_AVAILABLE: 'A recuperação de senha ainda não está disponível. Fale com o administrador da Construtec.',
    FEATURE_UNAVAILABLE: 'Esta função ainda não está disponível no servidor.',
    SESSION_INVALID: 'Sua sessão terminou. Entre com e-mail e senha.',
    SESSION_EXPIRED: 'Sua sessão terminou. Entre com e-mail e senha.',
  };
  const GENERIC_ERROR = 'Não foi possível entrar agora. Tente de novo.';

  function messageForCode(code) {
    return CODE_MESSAGES[code] || GENERIC_ERROR;
  }

  function validateEmail(value) {
    const email = String(value || '').trim();
    if (!email) return MSG.emailEmpty;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return MSG.emailInvalid;
    return '';
  }

  function validateLogin(email, password) {
    return validateEmail(email) || (String(password || '') ? '' : MSG.passwordEmpty);
  }

  function isDigits(pin) {
    return typeof pin === 'string' && pin.length === PIN_LENGTH && /^\d+$/.test(pin);
  }

  function isWeakPin(pin) {
    if (!isDigits(pin)) return true;
    if (/^(\d)\1+$/.test(pin)) return true;
    return '0123456789'.includes(pin) || '9876543210'.includes(pin);
  }

  function validatePinChoice(pin) {
    if (!isDigits(pin)) return { ok: false, message: 'Digite 6 dígitos.' };
    if (isWeakPin(pin)) return { ok: false, message: MSG.pinWeak };
    return { ok: true, message: '' };
  }

  function attemptState(failures) {
    const used = Math.max(0, Number(failures) || 0);
    const remaining = Math.max(0, MAX_ATTEMPTS - used);
    return { locked: remaining === 0, remaining };
  }

  function pinAttemptMessage(failures) {
    const { locked, remaining } = attemptState(failures);
    if (locked) return 'PIN bloqueado.';
    if (remaining === 1) return 'PIN incorreto. Resta 1 tentativa antes do bloqueio.';
    if (remaining === MAX_ATTEMPTS) return '';
    return `PIN incorreto. Restam ${remaining} tentativas.`;
  }

  function passwordChecks(value) {
    const pw = String(value || '');
    return {
      length: pw.length >= 8,
      upper: /[A-ZÀ-Ý]/.test(pw),
      number: /\d/.test(pw),
      symbol: /[^A-Za-zÀ-ÿ0-9\s]/.test(pw),
    };
  }

  const STRENGTH = [
    { label: 'Digite uma senha', color: '#6f8f9b' },
    { label: 'Fraca', color: '#f2b544' },
    { label: 'Razoável', color: '#f2b544' },
    { label: 'Boa', color: '#5fd0ee' },
    { label: 'Forte', color: '#3ddc84' },
  ];

  function passwordStrength(value) {
    const pw = String(value || '');
    if (!pw) return { score: 0, ...STRENGTH[0] };
    const met = Object.values(passwordChecks(pw)).filter(Boolean).length;
    const score = Math.max(1, met);
    return { score, ...STRENGTH[score] };
  }

  function passwordAcceptable(value) {
    const checks = passwordChecks(value);
    const met = Object.values(checks).filter(Boolean).length;
    return checks.length && met >= 3;
  }

  function validateNewPassword(password, confirm) {
    if (!passwordAcceptable(password)) return MSG.passwordWeak;
    if (String(password) !== String(confirm || '')) return MSG.passwordMismatch;
    return '';
  }

  function firstName(name) {
    return String(name || '').trim().split(/\s+/)[0] || '';
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (parts[0][0] + last).toUpperCase();
  }

  function resendRemaining(lastSentMs, nowMs) {
    if (!lastSentMs) return 0;
    const left = RESEND_SECONDS - Math.floor((nowMs - lastSentMs) / 1000);
    return Math.max(0, Math.min(RESEND_SECONDS, left));
  }

  function autoLockLabel(seconds) {
    const found = AUTO_LOCK.find((item) => item.seconds === seconds);
    return found ? found.label : AUTO_LOCK.find((item) => item.seconds === AUTO_LOCK_DEFAULT).label;
  }

  function parseResetFragment(hash) {
    const match = /(?:^|[#&])t=([A-Za-z0-9_-]{16,})/.exec(String(hash || ''));
    return match ? match[1] : '';
  }

  const api = {
    PIN_LENGTH, MAX_ATTEMPTS, RESEND_SECONDS, AUTO_LOCK, AUTO_LOCK_DEFAULT, MSG,
    messageForCode, validateEmail, validateLogin, isWeakPin, validatePinChoice,
    attemptState, pinAttemptMessage, passwordChecks, passwordStrength, passwordAcceptable,
    validateNewPassword, firstName, initials, resendRemaining, autoLockLabel, parseResetFragment,
  };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.AuthRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
