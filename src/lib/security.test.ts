import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPaymentGatewaySignature,
  createSvgCaptcha,
  generateTotpCode,
  generateTotpSecret,
  hashPassword,
  signPayload,
  verifyCaptchaAndRobot,
  verifyPassword,
  verifyPaymentGatewaySignature,
  verifySignedPayload,
  verifyTotpCode,
} from './security.ts';

test('scrypt password hashing verifies matching password and rejects wrong password', () => {
  const hash = hashPassword('Scholarship2026!');
  assert.equal(verifyPassword('Scholarship2026!', hash), true);
  assert.equal(verifyPassword('WrongPass123', hash), false);
});

test('RFC 6238 Google Authenticator TOTP generates and validates 6-digit codes', () => {
  const secret = generateTotpSecret();
  const now = 1_794_863_000_000;
  const code = generateTotpCode(secret, now);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotpCode(secret, code, now, 1), true);
  assert.equal(verifyTotpCode(secret, code, now + 25_000, 1), true);
  assert.equal(verifyTotpCode(secret, '000000', now, 0), code === '000000');
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
