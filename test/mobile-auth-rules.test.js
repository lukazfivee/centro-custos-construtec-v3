const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../android/app/src/main/assets/auth/rules.js');

test('PIN recusa repetidos e sequencias, aceita os demais', () => {
  for (const weak of ['000000', '111111', '012345', '123456', '456789', '987654', '543210']) {
    assert.equal(rules.validatePinChoice(weak).ok, false, weak);
    assert.equal(rules.validatePinChoice(weak).message, 'Evite números repetidos ou em sequência.');
  }
  for (const good of ['284615', '102938', '135790', '112233']) {
    assert.equal(rules.validatePinChoice(good).ok, true, good);
  }
  assert.equal(rules.validatePinChoice('12345').ok, false);
  assert.equal(rules.validatePinChoice('12a456').ok, false);
});

test('contador de tentativas do PIN bloqueia no terceiro erro', () => {
  assert.equal(rules.pinAttemptMessage(0), '');
  assert.equal(rules.pinAttemptMessage(1), 'PIN incorreto. Restam 2 tentativas.');
  assert.equal(rules.pinAttemptMessage(2), 'PIN incorreto. Resta 1 tentativa antes do bloqueio.');
  assert.deepEqual(rules.attemptState(2), { locked: false, remaining: 1 });
  assert.deepEqual(rules.attemptState(3), { locked: true, remaining: 0 });
  assert.deepEqual(rules.attemptState(9), { locked: true, remaining: 0 });
});

test('validacao local do login segue a especificacao', () => {
  assert.equal(rules.validateLogin('', 'x'), 'Digite seu e-mail.');
  assert.equal(rules.validateLogin('   ', 'x'), 'Digite seu e-mail.');
  assert.equal(rules.validateLogin('lucas@', 'x'), 'Esse e-mail não parece válido.');
  assert.equal(rules.validateLogin('lucas@rcconstrutec', 'x'), 'Esse e-mail não parece válido.');
  assert.equal(rules.validateLogin('lucas@rcconstrutec.com.br', ''), 'Digite sua senha para entrar.');
  assert.equal(rules.validateLogin(' lucas@rcconstrutec.com.br ', 'segredo'), '');
});

test('forca da senha tem 4 barras e rotulos da especificacao', () => {
  assert.deepEqual(
    ['', 'abc', 'abcdefgh', 'Abcdefgh', 'Abcdefg1', 'Abcdef1!'].map((pw) => rules.passwordStrength(pw).label),
    ['Digite uma senha', 'Fraca', 'Fraca', 'Razoável', 'Boa', 'Forte'],
  );
  assert.equal(rules.passwordStrength('Abcdef1!').color, '#3ddc84');
  assert.deepEqual(rules.passwordChecks('Ab1!'), { length: false, upper: true, number: true, symbol: true });
});

test('senha nova exige 8+ caracteres e 3 de 4 criterios, e confirmacao igual', () => {
  assert.equal(rules.passwordAcceptable('Ab1!'), false);
  assert.equal(rules.passwordAcceptable('abcdefgh'), false);
  assert.equal(rules.passwordAcceptable('abcdefg1'), false);
  assert.equal(rules.passwordAcceptable('Abcdefg1'), true);
  assert.equal(rules.passwordAcceptable('abcdef1!'), true);
  assert.equal(rules.validateNewPassword('abc', 'abc'), 'A senha ainda está fraca. Siga a lista acima.');
  assert.equal(rules.validateNewPassword('Abcdefg1', 'Abcdefg2'), 'As duas senhas não são iguais.');
  assert.equal(rules.validateNewPassword('Abcdefg1', 'Abcdefg1'), '');
});

test('mensagens do servidor saem do code, nunca do texto de erro', () => {
  assert.equal(rules.messageForCode('INVALID_CREDENTIALS'), 'E-mail ou senha incorretos.');
  assert.equal(rules.messageForCode('ACCOUNT_LEGACY'), 'Conta precisa ser reativada pelo administrador.');
  assert.equal(rules.messageForCode('OFFLINE'), 'Sem internet. Entre com o PIN ou tente de novo quando conectar.');
  assert.equal(rules.messageForCode('QUALQUER_OUTRO'), 'Não foi possível entrar agora. Tente de novo.');
  assert.equal(rules.messageForCode(undefined), 'Não foi possível entrar agora. Tente de novo.');
});

test('nome, iniciais, reenvio e bloqueio automatico', () => {
  assert.equal(rules.firstName('  Maria Clara Souza '), 'Maria');
  assert.equal(rules.initials('maria clara souza'), 'MS');
  assert.equal(rules.initials('Lucas'), 'L');
  assert.equal(rules.initials(''), '');
  assert.equal(rules.resendRemaining(0, 1000), 0);
  assert.equal(rules.resendRemaining(1_000, 11_000), 50);
  assert.equal(rules.resendRemaining(1_000, 90_000), 0);
  assert.equal(rules.autoLockLabel(300), '5 min');
  assert.equal(rules.autoLockLabel(12345), '5 min');
  assert.equal(rules.AUTO_LOCK_DEFAULT, 300);
  assert.deepEqual(rules.AUTO_LOCK.map((item) => item.label), ['Na hora', '1 min', '5 min', '15 min']);
});

test('token de redefinicao so e lido do fragmento', () => {
  const token = 'aB3_-'.repeat(8);
  assert.equal(rules.parseResetFragment(`#t=${token}`), token);
  assert.equal(rules.parseResetFragment(`#x=1&t=${token}`), token);
  assert.equal(rules.parseResetFragment('#t=curto'), '');
  assert.equal(rules.parseResetFragment(''), '');
});
