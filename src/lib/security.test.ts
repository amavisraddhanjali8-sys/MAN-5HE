import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPaymentGatewaySignature,
  createSvgCaptcha,
  decryptTotpSecret,
  encryptTotpSecret,
  generateBackupCodes,
  generateTotpCode,
  generateTotpSecret,
  getTotpEncryptionMasterKey,
  hashOtpCode,
  hashPassword,
  hashSecretToken,
  maskEmail,
  maskPhoneNumber,
  normalizeEmail,
  normalizeWhatsAppNumber,
  signPayload,
  validatePasswordPolicy,
  validateUsername,
  verifyCaptchaAndRobot,
  verifyOtpHash,
  verifyPassword,
  verifyPaymentGatewaySignature,
  verifySecretTokenHash,
  verifySignedPayload,
  verifyTotpCode,
  verifyTotpCodeWithStep,
} from './security.ts';

test('scrypt password hashing verifies matching password and rejects wrong password', () => {
  const hash = hashPassword('Scholarship2026!');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(verifyPassword('Scholarship2026!', hash), true);
  assert.equal(verifyPassword('WrongPass123', hash), false);
});

test('RFC 6238 Google Authenticator TOTP generates and validates 6-digit codes + step index', () => {
  const secret = generateTotpSecret();
  const now = 1_794_863_000_000;
  const code = generateTotpCode(secret, now);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotpCode(secret, code, now, 1), true);
  assert.equal(verifyTotpCode(secret, code, now + 25_000, 1), true);
  assert.equal(verifyTotpCode(secret, '000000', now, 0), code === '000000');

  const stepRes = verifyTotpCodeWithStep(secret, code, now, 1);
  assert.equal(stepRes.valid, true);
  assert.equal(stepRes.matchedStep, Math.floor(now / 1000 / 30));
});

test('AES-256-GCM encrypts TOTP secrets at rest and detects tampering', () => {
  const masterKey = getTotpEncryptionMasterKey();
  const plain = generateTotpSecret();
  const encrypted = encryptTotpSecret(plain, masterKey);
  assert.ok(encrypted.startsWith('enc:v1:'));
  assert.notEqual(encrypted, plain);
  assert.equal(decryptTotpSecret(encrypted, masterKey), plain);
  assert.throws(() => decryptTotpSecret(encrypted.slice(0, -4) + 'AAAA', masterKey));
});

test('OTP and secret token hashes verify properly and resist tampering', () => {
  const salt = 'test-salt-hex';
  const otpHash = hashOtpCode('482910', salt);
  assert.equal(verifyOtpHash('482910', salt, otpHash), true);
  assert.equal(verifyOtpHash('482911', salt, otpHash), false);

  const codes = generateBackupCodes(8);
  assert.equal(codes.length, 8);
  assert.match(codes[0], /^M5RC-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const tokHash = hashSecretToken(codes[0], 'pepper');
  assert.equal(verifySecretTokenHash(codes[0], tokHash, 'pepper'), true);
  assert.equal(verifySecretTokenHash('M5RC-0000-0000', tokHash, 'pepper'), false);
});

test('password policy rejects weak or identifier-containing passwords', () => {
  assert.equal(
    validatePasswordPolicy('Sh1!a', { username: 'sayuri', email: 'sayuri@man5he.lk' }).ok,
    false
  );
  assert.equal(
    validatePasswordPolicy('Sayuri@2026!', { username: 'sayuri', email: 'sayuri@man5he.lk' }).ok,
    false
  );
  assert.equal(
    validatePasswordPolicy('StrongLanka#92', { username: 'sayuri', email: 'sayuri@man5he.lk' }).ok,
    true
  );
});

test('username validation and contact normalization/masking enforce format rules', () => {
  assert.equal(validateUsername('admin').ok, false);
  assert.equal(validateUsername('ab').ok, false);
  assert.equal(validateUsername('sayuri.g5').ok, true);
  assert.equal(normalizeEmail(' Test@Man5He.LK ').email, 'test@man5he.lk');
  assert.equal(normalizeWhatsAppNumber('077 123 4567').normalized, '+94771234567');
  assert.ok(maskEmail('sayuri@man5he.lk').includes('***'));
  assert.ok(maskPhoneNumber('+94771234567').endsWith('67'));
});

test('HMAC signed session payload verifies integrity and detects tampering', () => {
  const secret = 'test-secret-key';
  const token = signPayload({ userId: 'u1', role: 'student' }, secret);
  const decoded = verifySignedPayload<{ userId: string; role: string }>(token, secret);
  assert.equal(decoded?.userId, 'u1');

  const tampered = token.slice(0, -3) + 'xyz';
  assert.equal(verifySignedPayload(tampered, secret), null);
});

test('SVG CAPTCHA + robot verification blocks honeypot and unchecked human check', () => {
  const secret = 'captcha-secret';
  const challenge = createSvgCaptcha(secret);
  const decoded = verifySignedPayload<{ ans: string; exp: number }>(
    challenge.captchaToken,
    secret
  );
  assert.ok(decoded?.ans);

  const valid = verifyCaptchaAndRobot({
    captchaToken: challenge.captchaToken,
    captchaAnswer: decoded!.ans,
    honeypotValue: '',
    humanChecked: true,
    secret,
  });
  assert.equal(valid.ok, true);

  const botAttempt = verifyCaptchaAndRobot({
    captchaToken: challenge.captchaToken,
    captchaAnswer: decoded!.ans,
    honeypotValue: 'spam-bot-fill',
    humanChecked: true,
    secret,
  });
  assert.equal(botAttempt.ok, false);
});

test('Payment gateway HMAC-SHA256 signature verification detects amount tampering', () => {
  const secret = 'payhere-secret';
  const sig = createPaymentGatewaySignature({
    merchantId: 'M5-MERCHANT',
    orderId: 'ORD-101',
    amountLkr: 3900,
    currency: 'LKR',
    secret,
  });
  assert.equal(
    verifyPaymentGatewaySignature({
      merchantId: 'M5-MERCHANT',
      orderId: 'ORD-101',
      amountLkr: 3900,
      currency: 'LKR',
      signature: sig,
      secret,
    }),
    true
  );
  assert.equal(
    verifyPaymentGatewaySignature({
      merchantId: 'M5-MERCHANT',
      orderId: 'ORD-101',
      amountLkr: 100,
      currency: 'LKR',
      signature: sig,
      secret,
    }),
    false
  );
});
