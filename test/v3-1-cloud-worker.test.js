const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('atividade do Worker não pula eventos após uma página cheia', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'cloudflare-sync-worker', 'src', 'index.js'), 'utf8');
  const worker = await import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport { activityCursor };`).toString('base64')}`);
  const page = Array.from({ length: 50 }, (_, index) => ({ id: index + 11 }));

  assert.equal(worker.activityCursor(10, page, 50, 200), 60);
  assert.equal(worker.activityCursor(60, page.slice(0, 2), 50, 200), 200);
});

test('Worker de reports consulta a entrega real no provedor', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'cloudflare-report-worker', 'src', 'index.js'), 'utf8');
  assert.match(source, /api\.resend\.com\/emails\/\$\{encodeURIComponent\(report\.email_id\)\}/);
  assert.match(source, /data\.last_event/);
  assert.match(source, /\/v1\\\/reports\\\/\(\[\^\/\]\+\)\\\/status/);
  assert.match(source, /emailConfigured/);
});
