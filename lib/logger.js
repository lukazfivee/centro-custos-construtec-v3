const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel() {
  const requested = String(process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')).toLowerCase();
  return LEVELS[requested] ? requested : 'info';
}

function shouldLog(level) {
  return LEVELS[level] >= LEVELS[configuredLevel()];
}

function cleanValue(value, depth = 0) {
  if (depth > 4) return '[depth-limit]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 1000 ? `${value.slice(0, 1000)}…` : value;
  if (value instanceof Error) return errorDetails(value);
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => cleanValue(item, depth + 1));
  if (typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (/password|senha|token|authorization|cookie|secret|conteudoBase64/i.test(key)) {
        result[key] = '[redacted]';
      } else {
        result[key] = cleanValue(item, depth + 1);
      }
    }
    return result;
  }
  return String(value);
}

function errorDetails(error) {
  if (!error) return null;
  return cleanValue({
    name: error.name,
    message: error.message,
    code: error.code,
    statusCode: error.statusCode,
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
  });
}

function log(level, event, details = {}) {
  if (!shouldLog(level)) return;
  const entry = cleanValue({
    timestamp: new Date().toISOString(),
    level,
    event,
    pid: process.pid,
    ...details,
  });
  const serialized = JSON.stringify(entry);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.log(serialized);
}

module.exports = {
  debug: (event, details) => log('debug', event, details),
  info: (event, details) => log('info', event, details),
  warn: (event, details) => log('warn', event, details),
  error: (event, details) => log('error', event, details),
  errorDetails,
};
