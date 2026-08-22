const { getInstanceIdentity } = require('../db');

const DEFAULT_API_URL = 'https://centro-custos-api.construtec-reports.workers.dev';

function apiUrl() {
  return String(process.env.SYNC_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
}

function configured() {
  return Boolean(apiUrl());
}

function corporateEmail(email) {
  return /^[^\s@]+@rcconstrutec\.com\.br$/i.test(String(email || '').trim());
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  timer.unref?.();
  try {
    const headers = { 'content-type':'application/json', ...(options.headers || {}) };
    const response = await fetch(`${apiUrl()}${path}`, { ...options, headers, signal:controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Cloud Auth HTTP ${response.status}`);
      error.status = response.status;
      error.code = data.code || '';
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeout = new Error('A autenticação central demorou para responder.');
      timeout.status = 503;
      timeout.code = 'AUTH_UNAVAILABLE';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function instanceHeaders() {
  const instance = getInstanceIdentity();
  const pkg = require('../package.json');
  return {
    'x-instance-id':instance.id,
    'x-instance-name':instance.name,
    'x-app-version':pkg.version,
    'x-platform':process.platform,
  };
}

async function login(email, password) {
  return request('/v1/auth/login', {
    method:'POST',
    headers:instanceHeaders(),
    body:JSON.stringify({ email, password }),
  });
}

async function bootstrap({ name, email, password, role }) {
  if (!process.env.SYNC_SHARED_KEY) {
    const error = new Error('Esta instalação não possui a chave administrativa para iniciar o diretório corporativo.');
    error.status = 503;
    error.code = 'BOOTSTRAP_KEY_MISSING';
    throw error;
  }
  return request('/v1/auth/bootstrap', {
    method:'POST',
    headers:{ ...instanceHeaders(), 'x-sync-key':process.env.SYNC_SHARED_KEY },
    body:JSON.stringify({ name, email, password, role }),
  });
}

async function listUsers(sessionToken) {
  return request('/v1/users', {
    method:'GET',
    headers:{ Authorization:`Bearer ${sessionToken}` },
  });
}

async function createUser(sessionToken, payload) {
  return request('/v1/users', {
    method:'POST',
    headers:{ Authorization:`Bearer ${sessionToken}` },
    body:JSON.stringify(payload),
  });
}

async function setUserStatus(sessionToken, email, active) {
  return request('/v1/users/status', {
    method:'POST',
    headers:{ Authorization:`Bearer ${sessionToken}` },
    body:JSON.stringify({ email, active }),
  });
}

async function changePassword(sessionToken, currentPassword, newPassword) {
  return request('/v1/auth/change-password', {
    method:'POST',
    headers:{ Authorization:`Bearer ${sessionToken}` },
    body:JSON.stringify({ currentPassword, newPassword }),
  });
}

async function getProfilePhoto(sessionToken) {
  return request('/v1/auth/profile-photo', {
    method:'GET',
    headers:{ Authorization:`Bearer ${sessionToken}` },
  });
}

async function setProfilePhoto(sessionToken, payload) {
  return request('/v1/auth/profile-photo', {
    method:'POST',
    headers:{ Authorization:`Bearer ${sessionToken}` },
    body:JSON.stringify(payload),
  });
}

async function removeProfilePhoto(sessionToken) {
  return request('/v1/auth/profile-photo', {
    method:'DELETE',
    headers:{ Authorization:`Bearer ${sessionToken}` },
  });
}

module.exports = {
  DEFAULT_API_URL,
  apiUrl,
  configured,
  corporateEmail,
  login,
  bootstrap,
  listUsers,
  createUser,
  setUserStatus,
  changePassword,
  getProfilePhoto,
  setProfilePhoto,
  removeProfilePhoto,
};
