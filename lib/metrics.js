const startedAt = Date.now();
const MAX_RECENT = 25;

const state = {
  requests: {
    total: 0,
    active: 0,
    errors: 0,
    slow: 0,
    durationMs: 0,
    maxDurationMs: 0,
    byMethod: Object.create(null),
    byStatus: Object.create(null),
    recentSlow: [],
  },
  database: {
    total: 0,
    errors: 0,
    slow: 0,
    durationMs: 0,
    maxDurationMs: 0,
    recentSlow: [],
  },
};

function pushRecent(list, value) {
  list.unshift(value);
  if (list.length > MAX_RECENT) list.length = MAX_RECENT;
}

function beginRequest(method) {
  state.requests.total += 1;
  state.requests.active += 1;
  const key = String(method || 'UNKNOWN').toUpperCase();
  state.requests.byMethod[key] = (state.requests.byMethod[key] || 0) + 1;
}

function finishRequest({ method, path, statusCode, durationMs, requestId, slowMs = 1000 }) {
  state.requests.active = Math.max(0, state.requests.active - 1);
  const duration = Number.isFinite(durationMs) ? durationMs : 0;
  state.requests.durationMs += duration;
  state.requests.maxDurationMs = Math.max(state.requests.maxDurationMs, duration);
  const statusKey = String(Number(statusCode) || 0);
  state.requests.byStatus[statusKey] = (state.requests.byStatus[statusKey] || 0) + 1;
  if (statusCode >= 500) state.requests.errors += 1;
  if (duration >= slowMs) {
    state.requests.slow += 1;
    pushRecent(state.requests.recentSlow, {
      at: new Date().toISOString(), method, path, statusCode,
      durationMs: round(duration), requestId,
    });
  }
}

function recordQuery({ operation = 'query', durationMs, failed = false, statement, slowMs = 500 }) {
  state.database.total += 1;
  const duration = Number.isFinite(durationMs) ? durationMs : 0;
  state.database.durationMs += duration;
  state.database.maxDurationMs = Math.max(state.database.maxDurationMs, duration);
  if (failed) state.database.errors += 1;
  if (duration >= slowMs) {
    state.database.slow += 1;
    pushRecent(state.database.recentSlow, {
      at: new Date().toISOString(), operation,
      durationMs: round(duration), failed: Boolean(failed), statement,
    });
  }
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function average(total, count) {
  return count ? round(total / count) : 0;
}

function snapshot() {
  const memory = process.memoryUsage();
  return {
    startedAt: new Date(startedAt).toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rssMb: round(memory.rss / 1024 / 1024),
      heapUsedMb: round(memory.heapUsed / 1024 / 1024),
      heapTotalMb: round(memory.heapTotal / 1024 / 1024),
      externalMb: round(memory.external / 1024 / 1024),
    },
    requests: {
      total: state.requests.total,
      active: state.requests.active,
      errors: state.requests.errors,
      slow: state.requests.slow,
      averageDurationMs: average(state.requests.durationMs, state.requests.total),
      maxDurationMs: round(state.requests.maxDurationMs),
      byMethod: { ...state.requests.byMethod },
      byStatus: { ...state.requests.byStatus },
      recentSlow: [...state.requests.recentSlow],
    },
    database: {
      total: state.database.total,
      errors: state.database.errors,
      slow: state.database.slow,
      averageDurationMs: average(state.database.durationMs, state.database.total),
      maxDurationMs: round(state.database.maxDurationMs),
      recentSlow: [...state.database.recentSlow],
    },
  };
}

function resetForTests() {
  for (const group of [state.requests, state.database]) {
    for (const key of Object.keys(group)) {
      if (Array.isArray(group[key])) group[key] = [];
      else if (typeof group[key] === 'object') group[key] = Object.create(null);
      else group[key] = 0;
    }
  }
}

module.exports = { beginRequest, finishRequest, recordQuery, snapshot, resetForTests };
