import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(bytesLength = 20): string {
  return base32Encode(crypto.randomBytes(bytesLength));
}

export function buildOtpAuthUri(accountEmail: string, secret: string, issuer = 'Man5he Scholarship'): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const iss = encodeURIComponent(issuer);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${iss}&algorithm=SHA1&digits=6&period=30`;
}

// RFC 6238 TOTP generation
export function generateTotpCode(secret: string, timestampMs = Date.now(), stepSeconds = 30): string {
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const key = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(
  secret: string,
  token: string,
  timestampMs = Date.now(),
  windowSteps = 1
): boolean {
  const normalized = token.trim();
  if (!/^\d{6}$/.test(normalized)) return false;

  for (let w = -windowSteps; w <= windowSteps; w++) {
    const candidate = generateTotpCode(secret, timestampMs + w * 30_000);
    if (
      crypto.timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(normalized, 'utf8'))
    ) {
      return true;
    }
  }
  return false;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(keyHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

export function signPayload(payload: object, secret: string): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifySignedPayload<T>(token: string, secret: string): T | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export interface CaptchaChallenge {
  captchaToken: string;
  svgMarkup: string;
  promptHint: string;
}

export function createSvgCaptcha(secret: string): CaptchaChallenge {
  const a = crypto.randomInt(2, 16);
  const b = crypto.randomInt(1, 12);
  const isAdd = crypto.randomInt(0, 2) === 0;
  const answer = isAdd ? a + b : a + b + 4 - b; // ensure non-negative simple arithmetic
  const left = isAdd ? a : a + b + 4;
  const right = b;
  const op = isAdd ? '+' : '−';
  const expression = `${left} ${op} ${right} = ?`;

  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="54" viewBox="0 0 180 54">
    <rect width="180" height="54" rx="10" fill="#EBF5FF" stroke="#B9DCF9" stroke-width="1.5"/>
    <path d="M10 16 Q 60 40, 170 14" stroke="#158EE3" stroke-opacity="0.28" stroke-width="2" fill="none"/>
    <path d="M12 42 Q 90 12, 168 38" stroke="#F96A1B" stroke-opacity="0.25" stroke-width="2" fill="none"/>
    <text x="90" y="34" text-anchor="middle" font-family="monospace" font-size="20" font-weight="700" fill="#0F2942" letter-spacing="2">${expression}</text>
  </svg>`;

  const captchaToken = signPayload(
    {
      ans: String(answer),
      nonce: crypto.randomBytes(6).toString('hex'),
      exp: Date.now() + 10 * 60 * 1000,
    },
    secret
  );

  return {
    captchaToken,
    svgMarkup,
    promptHint: 'Solve the math CAPTCHA shown in the image',
  };
}

export function verifyCaptchaAndRobot(params: {
  captchaToken: string;
  captchaAnswer: string;
  honeypotValue?: string;
  humanChecked: boolean;
  secret: string;
}): { ok: boolean; reason?: string } {
  if (params.honeypotValue && params.honeypotValue.trim().length > 0) {
    return { ok: false, reason: 'Automated bot submission rejected (honeypot triggered).' };
  }
  if (!params.humanChecked) {
    return { ok: false, reason: 'Please complete the robot verification checkbox.' };
  }
  const decoded = verifySignedPayload<{ ans: string; exp: number }>(
    params.captchaToken,
    params.secret
  );
  if (!decoded) {
    return { ok: false, reason: 'CAPTCHA challenge signature is invalid.' };
  }
  if (Date.now() > decoded.exp) {
    return { ok: false, reason: 'CAPTCHA expired. Please refresh the challenge.' };
  }
  if (decoded.ans !== params.captchaAnswer.trim()) {
    return { ok: false, reason: 'Incorrect CAPTCHA answer. Please try again.' };
  }
  return { ok: true };
}

export function generateEmailOtp(): string {
  return String(crypto.randomInt(100_000, 999_999));
}

export function createPaymentGatewaySignature(params: {
  merchantId: string;
  orderId: string;
  amountLkr: number;
  currency: string;
  secret: string;
}): string {
  const payload = `${params.merchantId}|${params.orderId}|${params.amountLkr.toFixed(2)}|${params.currency}`;
  return crypto.createHmac('sha256', params.secret).update(payload).digest('hex').toUpperCase();
}

export function verifyPaymentGatewaySignature(params: {
  merchantId: string;
  orderId: string;
  amountLkr: number;
  currency: string;
  signature: string;
  secret: string;
}): boolean {
  const expected = createPaymentGatewaySignature({
    merchantId: params.merchantId,
    orderId: params.orderId,
    amountLkr: params.amountLkr,
    currency: params.currency,
    secret: params.secret,
  });
  const sigBuf = Buffer.from(params.signature.toUpperCase(), 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
}
