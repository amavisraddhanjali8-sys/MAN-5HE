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

export function verifyTotpCodeWithStep(
  secret: string,
  token: string,
  timestampMs = Date.now(),
  windowSteps = 1,
  stepSeconds = 30
): { valid: boolean; matchedStep: number | null } {
  const normalized = token.trim();
  if (!/^\d{6}$/.test(normalized)) return { valid: false, matchedStep: null };

  const baseStep = Math.floor(timestampMs / 1000 / stepSeconds);
  for (let w = -windowSteps; w <= windowSteps; w++) {
    const stepTimeMs = (baseStep + w) * stepSeconds * 1000;
    const candidate = generateTotpCode(secret, stepTimeMs, stepSeconds);
    if (
      crypto.timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(normalized, 'utf8'))
    ) {
      return { valid: true, matchedStep: baseStep + w };
    }
  }
  return { valid: false, matchedStep: null };
}

export function verifyTotpCode(
  secret: string,
  token: string,
  timestampMs = Date.now(),
  windowSteps = 1
): boolean {
  return verifyTotpCodeWithStep(secret, token, timestampMs, windowSteps).valid;
}

export function hashPassword(password: string): string {
  const N = 32768;
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto
    .scryptSync(password, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 })
    .toString('hex');
  return `scrypt$${N}$${r}$${p}$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash) return false;
  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 6) return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = parts[4];
    const keyHex = parts[5];
    if (!N || !r || !p || !salt || !keyHex) return false;
    const derived = crypto.scryptSync(password, salt, 64, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });
    const original = Buffer.from(keyHex, 'hex');
    if (derived.length !== original.length) return false;
    return crypto.timingSafeEqual(derived, original);
  }

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
  return String(crypto.randomInt(100_000, 1_000_000));
}

export function hashOtpCode(otp: string, salt: string): string {
  return crypto.createHmac('sha256', salt).update(otp.trim()).digest('hex');
}

export function verifyOtpHash(otp: string, salt: string, expectedHash: string): boolean {
  const candidate = hashOtpCode(otp, salt);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function hashSecretToken(token: string, pepper: string): string {
  return crypto
    .createHmac('sha256', pepper)
    .update(token.trim().toUpperCase())
    .digest('hex');
}

export function verifySecretTokenHash(
  token: string,
  expectedHash: string,
  pepper: string
): boolean {
  const candidate = hashSecretToken(token, pepper);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let raw = '';
    for (let j = 0; j < 8; j++) {
      raw += BACKUP_ALPHABET[crypto.randomInt(0, BACKUP_ALPHABET.length)];
    }
    codes.push(`M5RC-${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

export function getTotpEncryptionMasterKey(): string {
  return (
    process.env.TOTP_ENCRYPTION_KEY ||
    process.env.AUTH_SESSION_SECRET ||
    'man5he-dev-session-secret-change-in-prod'
  );
}

function deriveAesKey(masterKey: string): Buffer {
  return crypto.createHash('sha256').update(`man5he-totp-v1:${masterKey}`).digest();
}

export function encryptTotpSecret(plaintextSecret: string, masterKey: string): string {
  if (plaintextSecret.startsWith('enc:v1:')) return plaintextSecret;
  const key = deriveAesKey(masterKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintextSecret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptTotpSecret(storedSecret: string, masterKey: string): string {
  if (!storedSecret) return '';
  if (!storedSecret.startsWith('enc:v1:')) {
    return storedSecret;
  }
  const parts = storedSecret.split(':');
  if (parts.length !== 5) {
    throw new Error('Malformed encrypted authenticator secret.');
  }
  const iv = Buffer.from(parts[2], 'base64url');
  const tag = Buffer.from(parts[3], 'base64url');
  const ciphertext = Buffer.from(parts[4], 'base64url');
  const key = deriveAesKey(masterKey);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

const COMMON_WEAK_PASSWORDS = new Set([
  'password',
  'password123',
  '12345678',
  '123456789',
  'qwerty123',
  'admin123',
  'letmein1',
  'welcome1',
  'scholarship',
  'man5he123',
]);

export function validatePasswordPolicy(
  password: string,
  context?: { username?: string; email?: string; userIdCode?: string }
): { ok: boolean; errors: string[]; strength: 'weak' | 'fair' | 'strong' } {
  const errors: string[] = [];
  if (typeof password !== 'string' || password.length < 8) {
    errors.push('Password must be at least 8 characters long.');
  }
  if (password.length > 128) {
    errors.push('Password cannot exceed 128 characters.');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Include at least one uppercase letter (A–Z).');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Include at least one lowercase letter (a–z).');
  }
  if (!/\d/.test(password)) {
    errors.push('Include at least one number (0–9).');
  }
  if (!/[^A-Za-z0-9\s]/.test(password)) {
    errors.push('Include at least one special character (e.g., @, #, !, $).');
  }
  const lower = password.toLowerCase();
  if (COMMON_WEAK_PASSWORDS.has(lower)) {
    errors.push('Choose a less common password.');
  }
  if (context?.username && context.username.length >= 3 && lower.includes(context.username.toLowerCase())) {
    errors.push('Password must not contain your username.');
  }
  if (context?.userIdCode && context.userIdCode.length >= 3 && lower.includes(context.userIdCode.toLowerCase())) {
    errors.push('Password must not contain your user ID code.');
  }
  const emailLocal = context?.email?.split('@')[0];
  if (emailLocal && emailLocal.length >= 3 && lower.includes(emailLocal.toLowerCase())) {
    errors.push('Password must not contain your email name.');
  }

  const strength: 'weak' | 'fair' | 'strong' =
    errors.length === 0 && password.length >= 10
      ? 'strong'
      : errors.length <= 1
      ? 'fair'
      : 'weak';

  return { ok: errors.length === 0, errors, strength };
}

const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'root',
  'system',
  'support',
  'helpdesk',
  'security',
  'official',
  'staff',
  'moderator',
  'mod',
  'man5he',
  'man5headmin',
  'superuser',
  'operator',
  'null',
  'undefined',
]);

export function validateUsername(raw: string): {
  ok: boolean;
  normalized: string;
  error?: string;
} {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized.length < 4 || normalized.length > 30) {
    return {
      ok: false,
      normalized,
      error: 'Username must be between 4 and 30 characters.',
    };
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,28}[a-z0-9]$/.test(normalized)) {
    return {
      ok: false,
      normalized,
      error:
        'Username may contain letters, numbers, dots, underscores, or hyphens, and must start and end with a letter or number.',
    };
  }
  if (/[._-]{2}/.test(normalized)) {
    return {
      ok: false,
      normalized,
      error: 'Username cannot contain consecutive punctuation characters.',
    };
  }
  if (RESERVED_USERNAMES.has(normalized) || normalized.startsWith('admin_') || normalized.startsWith('admin-')) {
    return {
      ok: false,
      normalized,
      error: 'This username is reserved and cannot be used.',
    };
  }
  return { ok: true, normalized };
}

export function normalizeEmail(raw: string): { ok: boolean; email: string; error?: string } {
  const email = String(raw || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 160) {
    return { ok: false, email, error: 'Please enter a valid email address.' };
  }
  return { ok: true, email };
}

export function normalizeWhatsAppNumber(raw: string): {
  ok: boolean;
  normalized: string;
  error?: string;
} {
  let cleaned = String(raw || '').trim().replace(/[\s()-]/g, '');
  if (cleaned.startsWith('00')) {
    cleaned = `+${cleaned.slice(2)}`;
  } else if (/^0\d{9}$/.test(cleaned)) {
    cleaned = `+94${cleaned.slice(1)}`;
  }
  if (!/^\+[1-9]\d{8,14}$/.test(cleaned)) {
    return {
      ok: false,
      normalized: cleaned,
      error: 'Enter a valid WhatsApp number in international format (e.g. +94771234567).',
    };
  }
  return { ok: true, normalized: cleaned };
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const prefix = local.slice(0, Math.min(2, local.length));
  return `${prefix}***@${domain}`;
}

export function maskPhoneNumber(phone: string): string {
  const clean = phone.replace(/\s+/g, '');
  if (clean.length <= 6) return '***';
  return `${clean.slice(0, 4)}••••${clean.slice(-3)}`;
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
