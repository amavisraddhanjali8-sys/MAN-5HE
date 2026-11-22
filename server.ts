import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { createServer as createViteServer } from 'vite';
import {
  TOTAL_VIRTUAL_POOL_SIZE,
  calculatePaperQualityAndDifficulty,
  evaluateStudentTrajectory,
  generateVirtualQuizFromPool,
  seededShuffle,
} from './src/lib/psychometrics.ts';
import {
  resolvePracticeStreamConfig,
  type PracticeLevelMode,
} from './src/lib/practiceAdaptive.ts';
import {
  buildOtpAuthUri,
  createPaymentGatewaySignature,
  createSvgCaptcha,
  decryptTotpSecret,
  generateEmailOtp,
  generateTotpCode,
  generateTotpSecret,
  getTotpEncryptionMasterKey,
  hashPassword,
  signPayload,
  validatePasswordPolicy,
  verifyCaptchaAndRobot,
  verifyPassword,
  verifyPaymentGatewaySignature,
  verifySignedPayload,
  verifyTotpCode,
} from './src/lib/security.ts';
import {
  buildOtpEmailHtml,
  buildProgressEmailHtml,
} from './src/lib/notifications.ts';
import { Man5heDatabase, resolveDefaultHierarchyForQuestion } from './src/server/db.ts';
import { AcademicService, HttpError } from './src/server/academicService.ts';
import { KnowledgeService } from './src/server/knowledgeService.ts';
import { AssessmentService } from './src/server/assessmentService.ts';
import { ParentIntelligenceService } from './src/server/parentIntelligenceService.ts';
import { WellbeingService } from './src/server/wellbeingService.ts';
import { AcademicRoutineService } from './src/server/routineService.ts';
import { GamifiedRoadmapService } from './src/server/roadmapService.ts';
import {
  IdentitySecurityService,
  type DispatchedOtpEvent,
} from './src/server/identitySecurityService.ts';
import {
  GEMINI_KNOWLEDGE_MODEL,
  generateEducationalKnowledgeDraft,
  isGeminiConfigured,
} from './src/server/aiKnowledge.ts';
import type {
  AttemptRecord,
  DifficultyTier,
  InterventionStatus,
  PaperCategoryLevel,
  QuizItem,
  StudentQuizView,
  UserAccount,
} from './src/lib/types.ts';

const PORT = Number(process.env.PORT || 3000);
const AUTH_SECRET = process.env.AUTH_SESSION_SECRET || 'man5he-dev-session-secret-change-in-prod';
const CAPTCHA_SECRET = process.env.CAPTCHA_SIGNING_SECRET || 'man5he-dev-captcha-secret-change-in-prod';
const PAYHERE_MERCHANT_ID = process.env.PAYHERE_MERCHANT_ID || 'M5-PAYHERE-SANDBOX';
const PAYHERE_SECRET = process.env.PAYHERE_MERCHANT_SECRET || 'man5he-payhere-sandbox-secret';
const ENABLE_EMAIL_OTP = process.env.ENABLE_EMAIL_OTP === 'true';
const ENABLE_TOTP = process.env.ENABLE_TOTP === 'true';
const MFA_ENABLED = ENABLE_EMAIL_OTP || ENABLE_TOTP;
const IS_PROD = process.env.NODE_ENV === 'production';

const database = new Man5heDatabase();
const service = new AcademicService(database);
const knowledgeService = new KnowledgeService(service);
const assessmentService = new AssessmentService(database, service);
const parentIntelligenceService = new ParentIntelligenceService(database, service);
const wellbeingService = new WellbeingService(service);
const routineService = new AcademicRoutineService(service, parentIntelligenceService, wellbeingService);
const roadmapService = new GamifiedRoadmapService(service, parentIntelligenceService, wellbeingService);
assessmentService.setOnAttemptCompletedHook((attemptId, stage) => {
  void parentIntelligenceService.generateReportForAssessmentAttempt(attemptId, {
    sendCompletionNoticeIfPending: stage === 'submitted',
    useAiAdaptation: isGeminiConfigured(),
  });
});

// Non-persistent dev-only recovery email preview buffer (NEVER persisted to SQLite logs)
const devSandboxRecoveryEmails: {
  id: string;
  toEmail: string;
  subject: string;
  category: string;
  otpCode?: string;
  htmlBody: string;
  sentAt: string;
  expiresMs: number;
}[] = [];

const identityService = new IdentitySecurityService(database, service, {
  sessionSecret: AUTH_SECRET,
  onDispatchOtp: (event: DispatchedOtpEvent) => {
    if (!IS_PROD && event.channel === 'email' && event.emailHtml) {
      devSandboxRecoveryEmails.unshift({
        id: `DEVMAIL-${crypto.randomBytes(4).toString('hex')}`,
        toEmail: event.destination,
        subject: event.emailSubject || 'Verification Security Code · මං 5හේ',
        category: event.purpose,
        otpCode: event.otpCode,
        htmlBody: event.emailHtml,
        sentAt: new Date().toISOString(),
        expiresMs: Date.now() + 10 * 60 * 1000,
      });
      if (devSandboxRecoveryEmails.length > 25) devSandboxRecoveryEmails.length = 25;
    }
  },
});

const ipRateBuckets = new Map<string, number[]>();
function rateLimitAuth(bucket: string, maxOverride?: number) {
  const windowMs = Math.max(10_000, Number(process.env.RATE_LIMIT_WINDOW_MS || 900_000));
  const maxAttempts = maxOverride || Math.max(5, Number(process.env.RATE_LIMIT_MAX_ATTEMPTS || 20));
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = `${bucket}:${getClientIp(req)}`;
    const now = Date.now();
    const recent = (ipRateBuckets.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= maxAttempts) {
      res.status(429).json({
        error: 'Too many authentication or recovery attempts from this address. Please try again later.',
      });
      return;
    }
    recent.push(now);
    ipRateBuckets.set(key, recent);
    next();
  };
}

function getClientIp(req: express.Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// Short-lived in-memory challenge maps for Email OTPs & Pending Registrations
const pendingRegistrations = new Map<
  string,
  {
    userIdCode: string;
    name: string;
    email: string;
    whatsappNumber: string;
    passwordHash: string;
    totpSecret: string;
    emailOtp: string;
    expiresAt: number;
  }
>();

const pendingLoginOtps = new Map<
  string,
  {
    userId: string;
    emailOtp: string | null;
    requireEmailOtp: boolean;
    requireTotp: boolean;
    expiresAt: number;
  }
>();

const pendingPaymentOtps = new Map<
  string,
  {
    userId: string;
    emailOtp: string;
    expiresAt: number;
  }
>();

const pendingCheckouts = new Map<
  string,
  {
    orderId: string;
    userId: string;
    planId: string;
    amountLkr: number;
    gateway: 'PayHere LKR' | 'Stripe Card';
    signature: string;
    createdAt: number;
  }
>();

type AuthedRequest = express.Request & { authUser: UserAccount; authJti?: string };

function getAuthenticatedContext(
  req: express.Request
): { user: UserAccount; jti?: string } | null {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return null;
  const payload = verifySignedPayload<{ userId: string; jti?: string; exp: number }>(
    token,
    AUTH_SECRET
  );
  if (!payload || Date.now() > payload.exp) return null;
  const user = service.getUserById(payload.userId);
  if (!user || user.active === false) return null;
  if (payload.jti && !identityService.isSessionValid(user.id, payload.jti)) {
    return null;
  }
  return { user, jti: payload.jti };
}

function issueSessionToken(req: express.Request, user: UserAccount): string {
  const ttlMs = 24 * 60 * 60 * 1000;
  const jti = crypto.randomBytes(12).toString('hex');
  identityService.createAuthSession({
    userId: user.id,
    tokenJti: jti,
    ipAddress: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
    expiresAtMs: Date.now() + ttlMs,
  });
  return signPayload(
    { userId: user.id, role: user.role, jti, exp: Date.now() + ttlMs },
    AUTH_SECRET
  );
}

function isTotpEnrollmentRequiredForUser(user: UserAccount): boolean {
  if (user.role === 'admin') return false;
  if (process.env.TOTP_MANDATORY_NON_ADMIN === 'false') return false;
  return !user.totpEnabled;
}

function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const ctx = getAuthenticatedContext(req);
  if (!ctx) {
    res.status(401).json({ error: 'Authentication required. Please log in.' });
    return;
  }
  (req as AuthedRequest).authUser = ctx.user;
  (req as AuthedRequest).authJti = ctx.jti;
  next();
}

function requireAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const ctx = getAuthenticatedContext(req);
  if (!ctx) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (ctx.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin role required to access this resource.' });
    return;
  }
  (req as AuthedRequest).authUser = ctx.user;
  (req as AuthedRequest).authJti = ctx.jti;
  next();
}

function requireTeacherOrAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const ctx = getAuthenticatedContext(req);
  if (!ctx) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (ctx.user.role !== 'admin' && ctx.user.role !== 'teacher') {
    res.status(403).json({ error: 'Teacher or Administrator authorization required.' });
    return;
  }
  (req as AuthedRequest).authUser = ctx.user;
  (req as AuthedRequest).authJti = ctx.jti;
  next();
}

function handleServiceError(res: express.Response, err: unknown) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('Server error:', err);
  res.status(500).json({ error: (err as Error)?.message || 'Internal server error' });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '6mb' }));

  // --- Health & Public Config ---
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, app: 'මං 5හේ', poolSize: TOTAL_VIRTUAL_POOL_SIZE, storage: 'sqlite' });
  });

  app.get('/api/auth/config', (_req, res) => {
    res.json({
      enableEmailOtp: ENABLE_EMAIL_OTP,
      enableTotp: ENABLE_TOTP,
      mfaRequired: MFA_ENABLED,
    });
  });

  // --- CAPTCHA & Robot Guard ---
  app.get('/api/auth/captcha', (_req, res) => {
    const challenge = createSvgCaptcha(CAPTCHA_SECRET);
    res.json(challenge);
  });

  // --- Registration ---
  app.post('/api/auth/register/init', async (req, res) => {
    try {
      const {
        userIdCode,
        name,
        email,
        whatsappNumber,
        password,
        guardianName,
        captchaToken,
        captchaAnswer,
        honeypotValue,
        humanChecked,
      } = req.body || {};

      const robotCheck = verifyCaptchaAndRobot({
        captchaToken: String(captchaToken || ''),
        captchaAnswer: String(captchaAnswer || ''),
        honeypotValue: String(honeypotValue || ''),
        humanChecked: Boolean(humanChecked),
        secret: CAPTCHA_SECRET,
      });
      if (!robotCheck.ok) {
        res.status(400).json({ error: robotCheck.reason });
        return;
      }

      const cleanEmail = String(email || '').trim().toLowerCase();
      const cleanCode = String(userIdCode || '').trim().toUpperCase();
      const cleanName = String(name || '').trim();
      const cleanWa = String(whatsappNumber || '').trim();

      if (!cleanName || !cleanEmail.includes('@') || !cleanCode || String(password || '').length < 6) {
        res.status(400).json({
          error: 'Provide valid User ID, Name, Email, WhatsApp Number, and Password (min 6 chars).',
        });
        return;
      }

      const pwPolicy = validatePasswordPolicy(String(password || ''), {
        username: cleanCode,
        email: cleanEmail,
        userIdCode: cleanCode,
      });
      if (!pwPolicy.ok) {
        res.status(400).json({ error: pwPolicy.errors[0] });
        return;
      }

      const exists =
        service.getUserByIdentifier(cleanEmail) || service.getUserByIdentifier(cleanCode);
      if (exists) {
        res.status(409).json({ error: 'An account with this Email or User ID already exists.' });
        return;
      }

      const totpSecret = generateTotpSecret();

      if (!MFA_ENABLED) {
        const newUser = service.createStudentUser({
          userIdCode: cleanCode,
          name: cleanName,
          email: cleanEmail,
          whatsappNumber: cleanWa || '+94770000000',
          passwordHash: hashPassword(String(password)),
          totpSecret,
          totpEnabled: false,
          guardianName: guardianName ? String(guardianName) : undefined,
        });

        service.recordWhatsAppLog({
          toNumber: newUser.whatsappNumber,
          category: 'registration',
          messageText: `🌟 Welcome to මං 5හේ, ${newUser.name}! Account ${newUser.userIdCode} is ready. Complete a plan checkout to unlock all 500,000+ shuffled Grade 5 quizzes.`,
        });

        const token = issueSessionToken(req, newUser);
        res.json({
          mfaRequired: false,
          token,
          user: service.sanitizeUser(newUser),
          totpEnrollmentRequired: isTotpEnrollmentRequiredForUser(newUser),
        });
        return;
      }

      const regId = `REG-${crypto.randomBytes(8).toString('hex')}`;
      const emailOtp = generateEmailOtp();
      const otpAuthUri = buildOtpAuthUri(cleanEmail, totpSecret, 'මං 5හේ Scholarship');
      const qrDataUrl = await QRCode.toDataURL(otpAuthUri, { width: 180, margin: 1 });

      pendingRegistrations.set(regId, {
        userIdCode: cleanCode,
        name: cleanName,
        email: cleanEmail,
        whatsappNumber: cleanWa || '+94770000000',
        passwordHash: hashPassword(String(password)),
        totpSecret,
        emailOtp,
        expiresAt: Date.now() + 15 * 60 * 1000,
      });

      service.recordEmailLog({
        toEmail: cleanEmail,
        subject: `Registration Verification Code (${emailOtp}) · මං 5හේ`,
        category: 'otp_register',
        otpCode: emailOtp,
        htmlBody: buildOtpEmailHtml({
          recipientName: cleanName,
          purpose: 'Registration',
          otpCode: emailOtp,
          userIdCode: cleanCode,
        }),
      });

      res.json({
        mfaRequired: true,
        registrationId: regId,
        totpSecret,
        otpAuthUri,
        qrDataUrl,
        message:
          'Verification code dispatched to your email. Scan the QR code with Google Authenticator and enter both codes.',
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/auth/register/verify', (req, res) => {
    try {
      const { registrationId, emailOtp, totpCode } = req.body || {};
      const pending = pendingRegistrations.get(String(registrationId || ''));
      if (!pending || Date.now() > pending.expiresAt) {
        res.status(400).json({ error: 'Registration session expired. Please restart registration.' });
        return;
      }
      if (String(emailOtp || '').trim() !== pending.emailOtp) {
        res.status(400).json({ error: 'Invalid Email Verification Code.' });
        return;
      }
      if (!verifyTotpCode(pending.totpSecret, String(totpCode || ''), Date.now(), 1)) {
        res.status(400).json({ error: 'Invalid Google Authenticator 6-digit TOTP code.' });
        return;
      }

      const newUser = service.createStudentUser({
        userIdCode: pending.userIdCode,
        name: pending.name,
        email: pending.email,
        whatsappNumber: pending.whatsappNumber,
        passwordHash: pending.passwordHash,
        totpSecret: pending.totpSecret,
        totpEnabled: true,
      });
      pendingRegistrations.delete(String(registrationId));

      service.recordWhatsAppLog({
        toNumber: newUser.whatsappNumber,
        category: 'registration',
        messageText: `🌟 Welcome to මං 5හේ, ${newUser.name}! Account ${newUser.userIdCode} is verified.`,
      });

      const token = issueSessionToken(req, newUser);
      res.json({
        token,
        user: service.sanitizeUser(newUser),
        totpEnrollmentRequired: isTotpEnrollmentRequiredForUser(newUser),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  // --- Login ---
  app.post('/api/auth/login/step1', rateLimitAuth('login', 25), (req, res) => {
    const {
      identifier,
      password,
      captchaToken,
      captchaAnswer,
      honeypotValue,
      humanChecked,
    } = req.body || {};

    const robotCheck = verifyCaptchaAndRobot({
      captchaToken: String(captchaToken || ''),
      captchaAnswer: String(captchaAnswer || ''),
      honeypotValue: String(honeypotValue || ''),
      humanChecked: Boolean(humanChecked),
      secret: CAPTCHA_SECRET,
    });
    if (!robotCheck.ok) {
      res.status(400).json({ error: robotCheck.reason });
      return;
    }

    const user = service.getUserByIdentifier(String(identifier || ''));
    if (!user || !verifyPassword(String(password || ''), user.passwordHash)) {
      res.status(401).json({ error: 'Invalid User ID / Username / Email or Password.' });
      return;
    }
    if (user.active === false) {
      res.status(403).json({ error: 'Account is currently deactivated. Contact administrator.' });
      return;
    }

    const requireEmailOtp = ENABLE_EMAIL_OTP;
    const requireTotp = ENABLE_TOTP || user.totpEnabled;

    if (!requireEmailOtp && !requireTotp) {
      const token = issueSessionToken(req, user);
      identityService.recordSecurityEvent({
        userId: user.id,
        eventType: 'LOGIN_SUCCESS',
        severity: 'info',
        ipAddress: getClientIp(req),
        summary: 'Signed in with password + CAPTCHA verification.',
      });
      res.json({
        mfaRequired: false,
        token,
        user: service.sanitizeUser(user),
        totpEnrollmentRequired: isTotpEnrollmentRequiredForUser(user),
      });
      return;
    }

    const loginChallengeId = `LGN-${crypto.randomBytes(8).toString('hex')}`;
    const emailOtp = requireEmailOtp ? generateEmailOtp() : null;
    pendingLoginOtps.set(loginChallengeId, {
      userId: user.id,
      emailOtp,
      requireEmailOtp,
      requireTotp,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    if (requireEmailOtp && emailOtp) {
      service.recordEmailLog({
        toEmail: user.email,
        subject: `Login Security Code (${emailOtp}) · මං 5හේ`,
        category: 'otp_login',
        otpCode: emailOtp,
        htmlBody: buildOtpEmailHtml({
          recipientName: user.name,
          purpose: 'Secure Login',
          otpCode: emailOtp,
          userIdCode: user.userIdCode,
        }),
      });
    }

    res.json({
      mfaRequired: true,
      requireEmailOtp,
      requireTotp,
      loginChallengeId,
      maskedEmail: user.email,
      userName: user.name,
      message: requireEmailOtp && requireTotp
        ? 'Credentials verified. Enter your Email OTP and Google Authenticator code.'
        : requireTotp
        ? 'Credentials verified. Enter your 6-digit Google Authenticator code (or a backup recovery code).'
        : 'Credentials verified. Enter the 6-digit Email OTP dispatched to your inbox.',
    });
  });

  app.post('/api/auth/login/step2', rateLimitAuth('login-step2', 25), (req, res) => {
    const { loginChallengeId, emailOtp, totpCode, backupCode } = req.body || {};
    const pending = pendingLoginOtps.get(String(loginChallengeId || ''));
    if (!pending || Date.now() > pending.expiresAt) {
      res.status(400).json({ error: 'Login verification session expired. Please sign in again.' });
      return;
    }
    if (pending.requireEmailOtp && String(emailOtp || '').trim() !== pending.emailOtp) {
      res.status(400).json({ error: 'Incorrect Email Verification Code.' });
      return;
    }
    const user = service.getUserById(pending.userId);
    if (!user) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }
    if (pending.requireTotp) {
      const suppliedBackup = String(backupCode || '').trim() ||
        (String(totpCode || '').trim().toUpperCase().startsWith('M5RC-') ? String(totpCode || '').trim() : '');
      if (suppliedBackup && user.role !== 'admin') {
        const consumed = identityService.consumeBackupCode(user.id, suppliedBackup, getClientIp(req));
        if (!consumed) {
          res.status(400).json({ error: 'Invalid or already consumed backup recovery code.' });
          return;
        }
      } else {
        const check = identityService.verifyTotpForUser(user, String(totpCode || ''), getClientIp(req));
        if (!check.valid) {
          res.status(400).json({ error: check.reason || 'Incorrect Google Authenticator 6-digit TOTP code.' });
          return;
        }
      }
    }

    pendingLoginOtps.delete(String(loginChallengeId));
    const token = issueSessionToken(req, user);
    identityService.recordSecurityEvent({
      userId: user.id,
      eventType: 'LOGIN_MFA_SUCCESS',
      severity: 'info',
      ipAddress: getClientIp(req),
      summary: 'Completed multi-factor authentication sign-in.',
    });
    res.json({
      token,
      user: service.sanitizeUser(user),
      totpEnrollmentRequired: isTotpEnrollmentRequiredForUser(user),
    });
  });

  app.get('/api/auth/sandbox-inbox', (req, res) => {
    const emailQuery = String(req.query.email || '').trim().toLowerCase();
    const dbEmails = service.getEmailLogs(emailQuery || undefined).slice(0, 10);
    if (IS_PROD) {
      res.json({ emails: dbEmails });
      return;
    }
    const now = Date.now();
    const activeDev = devSandboxRecoveryEmails.filter(
      (e) => e.expiresMs > now && (!emailQuery || e.toEmail.toLowerCase().includes(emailQuery))
    );
    const merged = [...activeDev, ...dbEmails]
      .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))
      .slice(0, 12);
    res.json({ emails: merged });
  });

  app.get('/api/auth/demo-totp-helper', async (req, res) => {
    if (IS_PROD) {
      res.status(404).json({ error: 'Not available in production.' });
      return;
    }
    const identifier = String(req.query.identifier || '').trim().toLowerCase();
    const allowedDemo = [
      'sayuri@man5he.lk',
      'm5-2026-001',
      'kasun@man5he.lk',
      'm5-2026-002',
      'parent@man5he.lk',
      'm5-par-01',
      'teacher.math@man5he.lk',
      'm5-tch-01',
      'teacher.lang@man5he.lk',
      'm5-tch-02',
      'admin@man5he.lk',
      'm5-admin-01',
    ];
    if (!allowedDemo.includes(identifier)) {
      res.status(403).json({ error: 'Helper available only for seeded sandbox demo accounts.' });
      return;
    }
    const user = service.getUserByIdentifier(identifier);
    if (!user) {
      res.status(404).json({ error: 'Demo user not found.' });
      return;
    }
    const plainSecret = decryptTotpSecret(user.totpSecret, getTotpEncryptionMasterKey());
    const otpAuthUri = buildOtpAuthUri(user.email, plainSecret, 'මං 5හේ Scholarship');
    const qrDataUrl = await QRCode.toDataURL(otpAuthUri, { width: 160, margin: 1 });
    const currentCode = generateTotpCode(plainSecret);
    res.json({
      userIdCode: user.userIdCode,
      email: user.email,
      totpSecret: plainSecret,
      qrDataUrl,
      currentCode,
    });
  });

  app.get('/api/auth/me', requireAuth, async (req, res) => {
    const user = (req as AuthedRequest).authUser;
    let qrDataUrl = '';
    if (!user.totpEnabled && user.role !== 'admin') {
      const plainSecret = decryptTotpSecret(user.totpSecret, getTotpEncryptionMasterKey());
      const otpAuthUri = buildOtpAuthUri(user.email, plainSecret, 'මං 5හේ Scholarship');
      qrDataUrl = await QRCode.toDataURL(otpAuthUri, { width: 160, margin: 1 });
    }
    res.json({
      user: service.sanitizeUser(user),
      totpEnrollmentRequired: isTotpEnrollmentRequiredForUser(user),
      totpSetup: {
        secret: '',
        qrDataUrl,
      },
    });
  });

  // --- Payment Plans, Signed Checkout & Invoices ---
  app.get('/api/payments/plans', (_req, res) => {
    res.json({ plans: service.getPaymentPlans() });
  });

  app.post('/api/payments/request-otp', requireAuth, (req, res) => {
    const user = (req as AuthedRequest).authUser;
    const otp = generateEmailOtp();
    const challengeId = `PAYOTP-${crypto.randomBytes(6).toString('hex')}`;
    pendingPaymentOtps.set(challengeId, {
      userId: user.id,
      emailOtp: otp,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    service.recordEmailLog({
      toEmail: user.email,
      subject: `Payment Authorization Code (${otp}) · මං 5හේ`,
      category: 'otp_payment',
      otpCode: otp,
      htmlBody: buildOtpEmailHtml({
        recipientName: user.name,
        purpose: 'Payment Creation',
        otpCode: otp,
        userIdCode: user.userIdCode,
      }),
    });

    res.json({
      paymentOtpChallengeId: challengeId,
      message: `Payment verification code dispatched to ${user.email}.`,
    });
  });

  app.post('/api/payments/create-checkout', requireAuth, (req, res) => {
    const user = (req as AuthedRequest).authUser;
    const { planId, gateway, paymentOtpChallengeId, emailOtp, totpCode } = req.body || {};

    if (ENABLE_EMAIL_OTP) {
      const otpChallenge = pendingPaymentOtps.get(String(paymentOtpChallengeId || ''));
      if (!otpChallenge || otpChallenge.userId !== user.id || Date.now() > otpChallenge.expiresAt) {
        res.status(400).json({ error: 'Request a Payment Email Verification Code first.' });
        return;
      }
      if (String(emailOtp || '').trim() !== otpChallenge.emailOtp) {
        res.status(400).json({ error: 'Invalid Payment Email Verification Code.' });
        return;
      }
      pendingPaymentOtps.delete(String(paymentOtpChallengeId));
    }

    if (ENABLE_TOTP || user.totpEnabled) {
      const check = identityService.verifyTotpForUser(user, String(totpCode || ''), getClientIp(req));
      if (!check.valid) {
        res.status(400).json({ error: check.reason || 'Invalid Google Authenticator TOTP code for payment.' });
        return;
      }
    }

    const plan = service.getPaymentPlans().find((p) => p.id === planId);
    if (!plan) {
      res.status(404).json({ error: 'Selected payment plan does not exist.' });
      return;
    }

    const orderId = `ORD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const chosenGateway = gateway === 'Stripe Card' ? 'Stripe Card' : 'PayHere LKR';
    const signature = createPaymentGatewaySignature({
      merchantId: PAYHERE_MERCHANT_ID,
      orderId,
      amountLkr: plan.priceLkr,
      currency: 'LKR',
      secret: PAYHERE_SECRET,
    });

    pendingCheckouts.set(orderId, {
      orderId,
      userId: user.id,
      planId: plan.id,
      amountLkr: plan.priceLkr,
      gateway: chosenGateway,
      signature,
      createdAt: Date.now(),
    });

    res.json({
      checkoutPayload: {
        merchantId: PAYHERE_MERCHANT_ID,
        orderId,
        amountLkr: plan.priceLkr,
        currency: 'LKR',
        gateway: chosenGateway,
        planName: plan.name,
        signature,
      },
    });
  });

  app.post('/api/payments/webhook/confirm', requireAuth, (req, res) => {
    const user = (req as AuthedRequest).authUser;
    const { orderId, signature } = req.body || {};
    const checkout = pendingCheckouts.get(String(orderId || ''));
    if (!checkout || checkout.userId !== user.id) {
      res.status(404).json({ error: 'Checkout order not found.' });
      return;
    }

    const validSig = verifyPaymentGatewaySignature({
      merchantId: PAYHERE_MERCHANT_ID,
      orderId: checkout.orderId,
      amountLkr: checkout.amountLkr,
      currency: 'LKR',
      signature: String(signature || ''),
      secret: PAYHERE_SECRET,
    });
    if (!validSig) {
      res.status(400).json({ error: 'Payment Gateway HMAC-SHA256 signature verification failed.' });
      return;
    }

    const plan = service.getPaymentPlans().find((p) => p.id === checkout.planId);
    if (!plan) {
      res.status(404).json({ error: 'Plan not found.' });
      return;
    }

    const { user: updatedUser, invoice } = service.activateSubscriptionAndCreateInvoice({
      user,
      plan,
      gateway: checkout.gateway,
    });
    pendingCheckouts.delete(checkout.orderId);

    res.json({ user: service.sanitizeUser(updatedUser), invoice });
  });

  app.get('/api/payments/invoices', requireAuth, (req, res) => {
    const user = (req as AuthedRequest).authUser;
    res.json({ invoices: service.getInvoicesForUser(user) });
  });

  // --- Curriculum Hierarchy (Subject -> Topic -> Subtopic) ---
  app.get('/api/subjects/hierarchy', requireAuth, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const ctx = service.buildAuthContext(user);
      res.json(service.getCurriculumHierarchy(ctx));
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  // --- 500,000+ Quiz Pool & Practice Rounds ---
  app.get('/api/quizzes/stats', requireAuth, (req, res) => {
    const user = (req as AuthedRequest).authUser;
    const ctx = service.buildAuthContext(user);
    const curated = service.listCuratedQuestions(ctx);
    const papers = service.getPapers();
    res.json({
      totalPoolCount: TOTAL_VIRTUAL_POOL_SIZE + curated.length,
      virtualPoolCount: TOTAL_VIRTUAL_POOL_SIZE,
      curatedCount: curated.length,
      papersCount: papers.length,
    });
  });

  app.get('/api/quizzes/practice-round', requireAuth, (req, res) => {
    const user = (req as AuthedRequest).authUser;
    const ctx = service.buildAuthContext(user);
    const tierParam = String(req.query.tier || 'All');
    const domainParam = String(req.query.domain || 'All');
    const subjectIdParam = String(req.query.subjectId || 'All');
    const topicIdParam = String(req.query.topicId || 'All');
    const subtopicIdParam = String(req.query.subtopicId || 'All');
    const questionIdParam = String(req.query.questionId || '');
    const rawLevelMode = String(req.query.levelMode || '');
    const proficiencyParam = String(req.query.proficiency || user.currentLevel);
    const count = Math.min(15, Math.max(5, Number(req.query.count || 8)));
    const seed = Number(req.query.seed || Date.now() % 1_000_000);

    const effectiveCount =
      user.subscriptionStatus === 'active' || user.role === 'admin' ? count : Math.min(count, 5);

    const hasLevelMode =
      rawLevelMode === 'Easy' || rawLevelMode === 'Medium' || rawLevelMode === 'Hard';
    const streamConfig = hasLevelMode
      ? resolvePracticeStreamConfig({
          levelMode: rawLevelMode as PracticeLevelMode,
          proficiencyLevel: proficiencyParam,
        })
      : null;

    let curatedPool = service.listCuratedQuestions(
      {
        ...ctx,
        role: 'student', // allow students all subjects in practice
      },
      false,
      true
    );

    if (streamConfig && !questionIdParam) {
      const allowedSet = new Set(streamConfig.allowedTiers);
      curatedPool = curatedPool.filter((q) => allowedSet.has(q.attributes.difficultyTier));
    } else if (tierParam !== 'All' && !questionIdParam) {
      curatedPool = curatedPool.filter((q) => q.attributes.difficultyTier === tierParam);
    }

    if (domainParam !== 'All') {
      curatedPool = curatedPool.filter((q) => q.attributes.cognitiveDomain === domainParam);
    }
    if (subjectIdParam !== 'All') {
      curatedPool = curatedPool.filter((q) => q.subjectId === subjectIdParam);
    }
    if (topicIdParam !== 'All') {
      curatedPool = curatedPool.filter((q) => q.topicId === topicIdParam);
    }
    if (subtopicIdParam !== 'All') {
      curatedPool = curatedPool.filter((q) => q.subtopicId === subtopicIdParam);
    }

    const rawPinned = questionIdParam ? service.resolveQuizById(questionIdParam) : null;
    const pinnedQuiz =
      rawPinned &&
      rawPinned.source === 'curated' &&
      user.role === 'student' &&
      rawPinned.approvalStatus &&
      rawPinned.approvalStatus !== 'ACTIVE'
        ? null
        : rawPinned;

    const sampledVirtual: QuizItem[] = [];
    const tierFilter =
      !streamConfig && tierParam !== 'All' ? (tierParam as DifficultyTier) : undefined;

    for (let i = 0; i < effectiveCount * 14 && sampledVirtual.length < effectiveCount; i++) {
      const idx = ((seed * 37 + i * 7919) % TOTAL_VIRTUAL_POOL_SIZE) + 1;
      const chosenTier = streamConfig
        ? streamConfig.allowedTiers[i % streamConfig.allowedTiers.length]
        : tierFilter;
      const baseQ = generateVirtualQuizFromPool(idx, chosenTier);
      const hier = resolveDefaultHierarchyForQuestion(baseQ.id, baseQ.attributes.cognitiveDomain);
      const q: QuizItem = {
        ...baseQ,
        subjectId: hier.subjectId,
        topicId: hier.topicId,
        subtopicId: hier.subtopicId,
        version: 1,
      };
      if (domainParam !== 'All' && q.attributes.cognitiveDomain !== domainParam) continue;
      if (subjectIdParam !== 'All' && q.subjectId !== subjectIdParam) continue;
      sampledVirtual.push(q);
    }

    let combined = seededShuffle([...curatedPool.slice(0, 4), ...sampledVirtual], seed).slice(
      0,
      effectiveCount
    );
    if (pinnedQuiz) {
      combined = [pinnedQuiz, ...combined.filter((q) => q.id !== pinnedQuiz.id)].slice(
        0,
        effectiveCount
      );
    }

    res.json({
      seed,
      subscriptionStatus: user.subscriptionStatus,
      totalAvailablePool: TOTAL_VIRTUAL_POOL_SIZE + curatedPool.length,
      streamConfig,
      quizzes: combined,
    });
  });

  app.post('/api/quizzes/practice-complete', requireAuth, async (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const {
        totalQuestions,
        correctCount,
        timeSpentSeconds,
        domainBreakdown,
        items,
        paperTitle,
        scheduledSessionId,
      } = req.body || {};

      const totalQ = Math.max(1, Number(totalQuestions || 1));
      const correct = Math.min(totalQ, Math.max(0, Number(correctCount || 0)));
      const scorePercent = Math.round((correct / totalQ) * 100);
      const starsEarned = correct * 3 + (scorePercent >= 80 ? 5 : 0);

      const { attempt, user: refreshedUser, trajectory } = service.recordRoundAttemptAndUpdateUser({
        user,
        paperId: scheduledSessionId ? `SCH-${scheduledSessionId}` : 'PRACTICE-500K',
        paperTitle: paperTitle ? String(paperTitle) : '500K+ Shuffled Practice Round',
        mode: 'practice',
        paperCategory: user.currentLevel,
        totalQuestions: totalQ,
        correctCount: correct,
        timeLimitSeconds: 0,
        timeSpentSeconds: Math.max(10, Number(timeSpentSeconds || 60)),
        starsEarned,
        domainBreakdown: domainBreakdown || {},
      });

      const dispatch = service.dispatchActivityEmailAndWhatsApp({
        user: refreshedUser,
        attempt,
        trajectory,
        emailSubject: `Practice Progress Report: ${attempt.paperTitle} (${scorePercent}%) · මං 5හේ`,
        whatsappCategory: 'milestone',
      });

      let parentReportId: string | null = null;
      if (Array.isArray(items) && items.length > 0) {
        try {
          const rpt = await parentIntelligenceService.createReportForRoundAttempt({
            student: refreshedUser,
            attempt,
            items: items.map((it: Record<string, unknown>) => ({
              quizId: String(it.quizId || ''),
              selectedIndex:
                typeof it.selectedIndex === 'number' ? it.selectedIndex : null,
              isCorrect: Boolean(it.isCorrect),
              hintsUsed: Boolean(it.hintsUsed),
            })),
            assessmentKind: 'practice_session',
            sendNotifications: true,
            useAiAdaptation: isGeminiConfigured(),
          });
          parentReportId = rpt.id;
        } catch {
          // do not fail practice completion if report build fails
        }
      }

      if (scheduledSessionId) {
        try {
          parentIntelligenceService.completeScheduledSession(
            refreshedUser,
            String(scheduledSessionId),
            attempt.id
          );
        } catch {
          // ignore if session already completed or unauthorized
        }
      }

      res.json({
        attempt,
        trajectory,
        parentReportId,
        user: service.sanitizeUser(refreshedUser),
        notificationsDispatched: {
          ...dispatch,
          toEmail: refreshedUser.email,
          toWhatsapp: refreshedUser.whatsappNumber,
        },
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  // --- Idempotent Granular Question Attempt Submission ---
  app.post('/api/attempts/submit', requireAuth, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const {
        questionId,
        submittedAnswerIndex,
        submissionStatus,
        responseDurationMs,
        hintUsed,
        contextMode,
        sessionId,
        deliveryContext,
        idempotencyKey,
        awardPracticeXp,
      } = req.body || {};

      if (!questionId || !idempotencyKey) {
        res.status(400).json({ error: 'questionId and idempotencyKey are required.' });
        return;
      }

      const result = service.recordQuestionAttempt({
        student: user,
        questionId: String(questionId),
        submittedAnswerIndex:
          typeof submittedAnswerIndex === 'number' ? submittedAnswerIndex : null,
        submissionStatus: submissionStatus || 'valid_answered',
        responseDurationMs: Number(responseDurationMs || 0),
        hintUsed: Boolean(hintUsed),
        contextMode: contextMode || 'practice',
        sessionId: String(sessionId || `SES-${Date.now()}`),
        deliveryContext: deliveryContext || {},
        idempotencyKey: String(idempotencyKey),
        awardPracticeXp: Boolean(awardPracticeXp),
      });

      const refreshedUser = service.getUserById(user.id)!;
      res.json({
        ...result,
        user: service.sanitizeUser(refreshedUser),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  // --- Question Bank, Intelligence & Reassignment (RBAC + Subject Scoped) ---
  app.get('/api/admin/quizzes', requireTeacherOrAdmin, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const ctx = service.buildAuthContext(user);
      const data = service.listQuestionsWithStats(ctx, {
        source: String(req.query.source || 'all'),
        subjectId: String(req.query.subjectId || 'All'),
        topicId: String(req.query.topicId || 'All'),
        subtopicId: String(req.query.subtopicId || 'All'),
        domain: String(req.query.domain || 'All'),
        difficulty: String(req.query.difficulty || 'All'),
        grade: String(req.query.grade || 'All'),
        questionType: String(req.query.questionType || 'All'),
        approvalStatus: String(req.query.approvalStatus || 'All'),
        cognitiveSkill: String(req.query.cognitiveSkill || 'All'),
        authorId: String(req.query.authorId || 'All'),
        performanceFlag: String(req.query.performanceFlag || 'All'),
        search: String(req.query.search || ''),
        page: Number(req.query.page || 1),
        pageSize: Number(req.query.pageSize || 20),
      });
      res.json(data);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/questions/:id/intelligence', requireTeacherOrAdmin, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const ctx = service.buildAuthContext(user);
      const detail = service.getQuestionDetailIntelligence(ctx, String(req.params.id));
      res.json(detail);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.patch('/api/questions/:id/reassign-subject', requireAdmin, (req, res) => {
    try {
      const admin = (req as AuthedRequest).authUser;
      const { subjectId, topicId, subtopicId, changeNote } = req.body || {};
      if (!subjectId) {
        res.status(400).json({ error: 'Target subjectId is required.' });
        return;
      }
      const updated = service.reassignQuestionSubject(admin, String(req.params.id), {
        subjectId: String(subjectId),
        topicId: topicId ? String(topicId) : undefined,
        subtopicId: subtopicId ? String(subtopicId) : undefined,
        changeNote: changeNote ? String(changeNote) : undefined,
      });
      res.json({ quiz: updated });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/quizzes', requireAdmin, (req, res) => {
    try {
      const admin = (req as AuthedRequest).authUser;
      const quiz = service.createQuestion(admin, req.body || {});
      res.status(201).json({ quiz });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.delete('/api/quizzes/:id', requireAdmin, (req, res) => {
    try {
      const admin = (req as AuthedRequest).authUser;
      service.deleteQuestion(admin, String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  // --- Exam Papers & Automated Quality Evaluation ---
  app.get('/api/papers', requireAuth, (_req, res) => {
    res.json({ papers: service.getPapers() });
  });

  app.post('/api/papers/preview-quality', requireAdmin, (req, res) => {
    const { quizIds } = req.body || {};
    if (!Array.isArray(quizIds)) {
      res.status(400).json({ error: 'quizIds array required.' });
      return;
    }
    const items = quizIds
      .map((id) => service.resolveQuizById(String(id)))
      .filter(Boolean) as QuizItem[];
    res.json({ qualitySummary: calculatePaperQualityAndDifficulty(items) });
  });

  app.post('/api/papers', requireAdmin, (req, res) => {
    try {
      const admin = (req as AuthedRequest).authUser;
      const paper = service.createPaper(admin, req.body || {});
      res.status(201).json({ paper });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/papers/:id/start', requireAuth, (req, res) => {
    const user = (req as AuthedRequest).authUser;
    const paper = service.getPaperById(String(req.params.id));
    if (!paper) {
      res.status(404).json({ error: 'Exam paper not found.' });
      return;
    }

    const sessionId = service.createExamSession(user.id, paper);
    const timeLimitSeconds = paper.durationMinutes * 60;

    const sanitizedQuestions: StudentQuizView[] = paper.quizIds
      .map((id) => service.resolveQuizById(id))
      .filter(Boolean)
      .map((q) => {
        const item = q!;
        return {
          id: item.id,
          source: item.source,
          subjectId: item.subjectId,
          topicId: item.topicId,
          subtopicId: item.subtopicId,
          version: item.version,
          questionSi: item.questionSi,
          questionEn: item.questionEn,
          options: item.options,
          imageUrl: item.imageUrl,
          attributes: item.attributes,
        };
      });

    const userAttempts = service.getRoundAttemptsForUser(user.id);
    const trajectory = evaluateStudentTrajectory(userAttempts, user.currentLevel);

    if (user.guardianContactVerified && user.guardianConsentGiven) {
      service.recordEmailLog({
        toEmail: user.email,
        subject: `Mock Paper Started: ${paper.title} (${paper.durationMinutes} min) · මං 5හේ`,
        category: 'progress_report',
        htmlBody: buildProgressEmailHtml({
          studentName: user.name,
          attempt: {
            id: sessionId,
            userId: user.id,
            paperId: paper.id,
            paperTitle: `${paper.title} (Started)`,
            mode: 'timed_exam',
            paperCategory: paper.qualitySummary.categoryLevel,
            totalQuestions: sanitizedQuestions.length,
            correctCount: 0,
            scorePercent: 0,
            timeLimitSeconds,
            timeSpentSeconds: 0,
            starsEarned: 0,
            domainBreakdown: {},
            submittedAt: new Date().toISOString(),
          },
          trajectory,
        }),
      });

      service.recordWhatsAppLog({
        toNumber: user.whatsappNumber,
        category: 'exam_report',
        messageText: `📝 *මං 5හේ Mock Paper Alert*\nStudent: ${user.name}\nStarted Timed Mock Paper: ${paper.title}\nQuestions: ${sanitizedQuestions.length} · Time Limit: ${paper.durationMinutes} min\nFull score & fallback review report will follow on submission.`,
      });
    }

    res.json({
      sessionId,
      paper,
      timeLimitSeconds,
      questions: sanitizedQuestions,
    });
  });

  app.post('/api/papers/:id/submit', requireAuth, async (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const { sessionId, answers, perQuestionDurationsMs, timedOut, scheduledSessionId } = req.body || {};
      const paper = service.getPaperById(String(req.params.id));
      if (!paper) {
        res.status(404).json({ error: 'Paper not found.' });
        return;
      }

      const session = service.consumeExamSession(String(sessionId || ''));
      const elapsedSeconds = session
        ? Math.max(1, Math.round((Date.now() - session.startedAtMs) / 1000))
        : paper.durationMinutes * 60;
      const timeLimitSeconds = paper.durationMinutes * 60;
      const cappedTimeSpent = Math.min(elapsedSeconds, timeLimitSeconds);

      const answerMap: Record<string, number> = answers || {};
      const durationMap: Record<string, number> = perQuestionDurationsMs || {};
      let correctCount = 0;
      const domainBreakdown: Record<string, { correct: number; total: number }> = {};
      const reviewItems: {
        quizId: string;
        questionSi: string;
        selectedIndex: number | null;
        correctIndex: number;
        isCorrect: boolean;
        memoryTrickTitle: string;
        memoryTrickBody: string;
        explanation: string;
      }[] = [];

      const avgPerQMs = Math.max(
        5000,
        Math.round((cappedTimeSpent * 1000) / Math.max(1, paper.quizIds.length))
      );

      for (const qId of paper.quizIds) {
        const q = service.resolveQuizById(qId);
        if (!q) continue;
        const sel = typeof answerMap[q.id] === 'number' ? answerMap[q.id] : null;
        const isCorrect = sel === q.correctIndex;
        if (isCorrect) correctCount++;

        const dom = q.attributes.cognitiveDomain;
        if (!domainBreakdown[dom]) domainBreakdown[dom] = { correct: 0, total: 0 };
        domainBreakdown[dom].total += 1;
        if (isCorrect) domainBreakdown[dom].correct += 1;

        reviewItems.push({
          quizId: q.id,
          questionSi: q.questionSi,
          selectedIndex: sel,
          correctIndex: q.correctIndex,
          isCorrect,
          memoryTrickTitle: q.memoryTrickTitle,
          memoryTrickBody: q.memoryTrickBody,
          explanation: q.explanation,
        });

        // Record immutable granular question_attempt (separating unanswered/timed_out cleanly)
        const status =
          sel !== null ? 'valid_answered' : timedOut ? 'timed_out' : 'unanswered';
        service.recordQuestionAttempt({
          student: user,
          questionId: q.id,
          submittedAnswerIndex: sel,
          submissionStatus: status,
          responseDurationMs: Number(durationMap[q.id] || avgPerQMs),
          hintUsed: false,
          contextMode: 'timed_exam',
          sessionId: String(sessionId || `EXM-${Date.now()}`),
          deliveryContext: { paperId: paper.id },
          idempotencyKey: `exam-${sessionId || Date.now()}-${user.id}-${q.id}`,
          awardPracticeXp: false,
        });
      }

      const totalQuestions = Math.max(1, reviewItems.length);
      const scorePercent = Math.round((correctCount / totalQuestions) * 100);
      const starsEarned =
        correctCount * 4 + (scorePercent >= paper.qualitySummary.estimatedPassMark ? 10 : 2);

      const { attempt, user: refreshedUser, trajectory } = service.recordRoundAttemptAndUpdateUser({
        user,
        paperId: paper.id,
        paperTitle: paper.title,
        mode: 'timed_exam',
        paperCategory: paper.qualitySummary.categoryLevel,
        totalQuestions,
        correctCount,
        timeLimitSeconds,
        timeSpentSeconds: cappedTimeSpent,
        starsEarned,
        domainBreakdown,
      });

      const dispatch = service.dispatchActivityEmailAndWhatsApp({
        user: refreshedUser,
        attempt,
        trajectory,
        emailSubject: `Exam Progress Report: ${paper.title} (${scorePercent}%) · මං 5හේ`,
        whatsappCategory: 'exam_report',
      });

      let parentReportId: string | null = null;
      try {
        const rpt = await parentIntelligenceService.createReportForRoundAttempt({
          student: refreshedUser,
          attempt,
          items: reviewItems.map((ri) => ({
            quizId: ri.quizId,
            selectedIndex: ri.selectedIndex,
            isCorrect: ri.isCorrect,
          })),
          assessmentKind: 'mock_exam',
          sendNotifications: true,
          useAiAdaptation: isGeminiConfigured(),
        });
        parentReportId = rpt.id;
      } catch {
        // do not block response
      }

      if (scheduledSessionId) {
        try {
          parentIntelligenceService.completeScheduledSession(
            refreshedUser,
            String(scheduledSessionId),
            attempt.id
          );
        } catch {
          // ignore
        }
      }

      res.json({
        attempt,
        trajectory,
        reviewItems,
        parentReportId,
        user: service.sanitizeUser(refreshedUser),
        timedOutNotice: elapsedSeconds > timeLimitSeconds + 15,
        notificationsDispatched: {
          ...dispatch,
          toEmail: refreshedUser.email,
          toWhatsapp: refreshedUser.whatsappNumber,
        },
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  // --- Student, Scoped & Admin Analytics ---
  app.get('/api/analytics/student', requireAuth, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const requestedStudentId = req.query.studentId ? String(req.query.studentId) : '';
      let targetStudentId = user.id;
      let targetLevel = user.currentLevel;
      if (user.role === 'parent') {
        const linked = parentIntelligenceService.getLinkedStudents(user).filter((l) => l.verified);
        const selected = requestedStudentId
          ? linked.find((l) => l.studentUserId === requestedStudentId)
          : linked[0];
        if (requestedStudentId && !selected) {
          res.status(403).json({ error: 'Access denied: student is not verified on your guardian account.' });
          return;
        }
        if (selected) {
          targetStudentId = selected.studentUserId;
          if (selected.studentCurrentLevel) targetLevel = selected.studentCurrentLevel;
        }
      }
      const attempts = service.getRoundAttemptsForUser(targetStudentId);
      const trajectory = evaluateStudentTrajectory(attempts, targetLevel);
      const ctx = service.buildAuthContext(user);
      const recentQuestionAnalytics = service.getScopedAnalytics(ctx);
      res.json({
        user: service.sanitizeUser(user),
        attempts,
        trajectory,
        recentQuestionAnalytics,
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.patch('/api/analytics/daily-goal', requireAuth, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const updated = service.updateDailyGoal(user.id, req.body?.targetQuestions);
      res.json({
        user: service.sanitizeUser(updated),
        dailyGoalQuestions: updated.dailyGoalQuestions,
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/analytics/scoped', requireTeacherOrAdmin, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const ctx = service.buildAuthContext(user);
      const data = service.getScopedAnalytics(ctx, {
        subjectId: req.query.subjectId ? String(req.query.subjectId) : undefined,
        topicId: req.query.topicId ? String(req.query.topicId) : undefined,
        subtopicId: req.query.subtopicId ? String(req.query.subtopicId) : undefined,
        questionId: req.query.questionId ? String(req.query.questionId) : undefined,
        difficulty: req.query.difficulty ? String(req.query.difficulty) : undefined,
        dateFrom: req.query.dateFrom ? String(req.query.dateFrom) : undefined,
        dateTo: req.query.dateTo ? String(req.query.dateTo) : undefined,
        studentId: req.query.studentId ? String(req.query.studentId) : undefined,
        interventionStatus: req.query.interventionStatus
          ? String(req.query.interventionStatus)
          : undefined,
      });
      res.json(data);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/analytics/admin', requireAdmin, (req, res) => {
    const user = (req as AuthedRequest).authUser;
    const ctx = service.buildAuthContext(user);
    const students = service.listStudentsScoped(ctx);
    const allRounds = service.getAllRoundAttempts(50);
    const invoices = service.getInvoicesForUser(user);
    const totalRevenueLkr = invoices.reduce((acc, inv) => acc + inv.amountLkr, 0);
    const avgScore =
      allRounds.length > 0
        ? Math.round(allRounds.reduce((acc, a) => acc + a.scorePercent, 0) / allRounds.length)
        : 0;
    const curatedCount = service.listCuratedQuestions(ctx).length;
    const papers = service.getPapers();

    res.json({
      totalStudents: students.length,
      activePaidStudents: students.filter((s) => s.subscriptionStatus === 'active').length,
      totalQuizCapacity: TOTAL_VIRTUAL_POOL_SIZE + curatedCount,
      curatedQuizzesCount: curatedCount,
      papersCount: papers.length,
      totalAttempts: allRounds.length,
      averagePlatformScore: avgScore,
      totalRevenueLkr,
      recentAttempts: allRounds.slice(0, 12),
      students: students.map((s) => {
        const sAttempts = service.getRoundAttemptsForUser(s.id);
        return {
          ...s,
          attemptCount: sAttempts.length,
          trajectory: evaluateStudentTrajectory(sAttempts, s.currentLevel),
        };
      }),
    });
  });

  // --- Admin Teacher, Student, Consent, Config, Audit & Recalculation ---
  app.get('/api/admin/teachers', requireAdmin, (_req, res) => {
    res.json({ teachers: service.listTeachers() });
  });

  app.post('/api/admin/teachers', requireAdmin, (req, res) => {
    try {
      const admin = (req as AuthedRequest).authUser;
      const teacher = service.createTeacher(admin, req.body || {});
      res.status(201).json({ teacher });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.put('/api/admin/teachers/:id/subjects', requireAdmin, (req, res) => {
    try {
      const admin = (req as AuthedRequest).authUser;
      const subjectIds = Array.isArray(req.body?.subjectIds) ? req.body.subjectIds : [];
      const teacher = service.setTeacherSubjects(admin, String(req.params.id), subjectIds);
      res.json({ teacher });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.patch('/api/admin/teachers/:id/status', requireAdmin, (req, res) => {
    try {
      const admin = (req as AuthedRequest).authUser;
      const teacher = service.updateTeacherStatus(
        admin,
        String(req.params.id),
        Boolean(req.body?.active)
      );
      res.json({ teacher });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/admin/students', requireTeacherOrAdmin, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const ctx = service.buildAuthContext(user);
      res.json({ students: service.listStudentsScoped(ctx) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.patch('/api/students/:id/guardian', requireAuth, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const updated = service.updateStudentGuardianConsent(
        actor,
        String(req.params.id),
        req.body || {}
      );
      res.json({ user: updated });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/admin/config', requireTeacherOrAdmin, (_req, res) => {
    res.json({ config: service.getAcademicConfig() });
  });

  app.put('/api/admin/config', requireAdmin, (req, res) => {
    try {
      const admin = (req as AuthedRequest).authUser;
      const config = service.updateAcademicConfig(admin, req.body || {});
      res.json({ config });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/admin/audit-logs', requireAdmin, (req, res) => {
    const limit = Number(req.query.limit || 60);
    res.json({ logs: service.listAuditLogs(limit) });
  });

  app.post('/api/admin/analytics/recalculate', requireAdmin, (req, res) => {
    try {
      const admin = (req as AuthedRequest).authUser;
      res.json(service.recalculateAllAnalytics(admin));
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  // --- Interventions Console & Student Instructions ---
  app.get('/api/interventions', requireTeacherOrAdmin, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const ctx = service.buildAuthContext(user);
      const result = service.listInterventionCases(ctx, {
        status: req.query.status ? String(req.query.status) : undefined,
        subjectId: req.query.subjectId ? String(req.query.subjectId) : undefined,
        studentId: req.query.studentId ? String(req.query.studentId) : undefined,
      });
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/interventions/:id', requireAuth, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const ctx = service.buildAuthContext(user);
      const detail = service.getInterventionCaseDetail(ctx, String(req.params.id));
      res.json(detail);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/interventions/:id/actions', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const {
        nextStatus,
        templateId,
        instructionTitle,
        instructionBody,
        recommendedPracticeTopicId,
        notes,
        dismissalReason,
        resolutionNotes,
        notifyGuardian,
      } = req.body || {};

      const updated = service.applyInterventionAction(actor, String(req.params.id), {
        nextStatus: nextStatus as InterventionStatus | undefined,
        templateId,
        instructionTitle,
        instructionBody,
        recommendedPracticeTopicId,
        notes,
        dismissalReason,
        resolutionNotes,
        notifyGuardian,
      });
      res.json(updated);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/student/interventions', requireAuth, (req, res) => {
    const user = (req as AuthedRequest).authUser;
    res.json({ interventions: service.listStudentInterventions(user.id) });
  });

  // --- Notifications & Communications ---
  app.get('/api/notifications', requireAuth, (req, res) => {
    const user = (req as AuthedRequest).authUser;
    res.json(service.listNotifications(user));
  });

  app.patch('/api/notifications/:id/read', requireAuth, (req, res) => {
    const user = (req as AuthedRequest).authUser;
    service.markNotificationRead(user.id, String(req.params.id));
    res.json({ ok: true });
  });

  app.post('/api/notifications/:id/retry', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      res.json(service.retryNotification(actor, String(req.params.id)));
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.patch('/api/notifications/preferences', requireAuth, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const preferences = service.updateNotificationPreferences(user.id, req.body || {});
      res.json({ preferences });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/communications/logs', requireAuth, (req, res) => {
    const user = (req as AuthedRequest).authUser;
    const emails = service.getEmailLogs(user.role === 'admin' ? undefined : user.email);
    const whatsapps = service.getWhatsAppLogs(
      user.role === 'admin' ? undefined : user.whatsappNumber
    );
    res.json({ emails, whatsapps });
  });

  app.post('/api/communications/send-progress', requireAuth, (req, res) => {
    const user = (req as AuthedRequest).authUser;
    const attempts = service.getRoundAttemptsForUser(user.id);
    const latestAttempt: AttemptRecord = attempts[0] || {
      id: 'ATT-SNAPSHOT',
      userId: user.id,
      paperId: 'SNAPSHOT',
      paperTitle: 'Weekly Scholarship Snapshot',
      mode: 'practice',
      paperCategory: user.currentLevel,
      totalQuestions: 10,
      correctCount: 8,
      scorePercent: 80,
      timeLimitSeconds: 0,
      timeSpentSeconds: 420,
      starsEarned: 20,
      domainBreakdown: {},
      submittedAt: new Date().toISOString(),
    };
    const trajectory = evaluateStudentTrajectory(attempts, user.currentLevel);
    const dispatch = service.dispatchActivityEmailAndWhatsApp({
      user,
      attempt: latestAttempt,
      trajectory,
      emailSubject: `Parent Progress Snapshot · ${user.name} (${trajectory.scholarshipReadinessPercent}% Ready)`,
      whatsappCategory: 'milestone',
    });

    if (dispatch.skippedUnverified) {
      res.status(400).json({
        error:
          'External progress report withheld: guardian contact verification and consent are required first.',
      });
      return;
    }

    res.json({
      ok: true,
      message: `Progress snapshot dispatched to ${user.email} and WhatsApp ${user.whatsappNumber}.`,
    });
  });

  // --- Knowledge Discovery, Publishing & Multi-Channel Distribution ---
  app.get('/api/knowledge/ai-status', requireTeacherOrAdmin, (_req, res) => {
    res.json({
      configured: isGeminiConfigured(),
      model: GEMINI_KNOWLEDGE_MODEL,
    });
  });

  app.post('/api/knowledge/ai-draft', requireTeacherOrAdmin, async (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const { sourceTitle, sourceUrl, sourceExcerpt, targetGrade, language, subjectId } =
        req.body || {};
      if (!sourceTitle || !sourceExcerpt || String(sourceExcerpt).trim().length < 20) {
        res.status(400).json({
          error: 'Provide a verified source title and source excerpt (at least 20 characters).',
        });
        return;
      }

      const ctx = service.buildAuthContext(user);
      if (user.role === 'teacher' && subjectId && !ctx.assignedSubjectIds.includes(String(subjectId))) {
        res.status(403).json({ error: 'Selected subject is outside your assigned teacher subjects.' });
        return;
      }

      const hier = service.getCurriculumHierarchy(ctx);
      const draft = await generateEducationalKnowledgeDraft({
        sourceTitle: String(sourceTitle),
        sourceUrl: sourceUrl ? String(sourceUrl) : undefined,
        sourceExcerpt: String(sourceExcerpt),
        targetGrade: String(targetGrade || 'Grade 5'),
        language: String(language || 'bilingual'),
        subjects: hier.subjects,
      });

      const duplicateMatches = knowledgeService.checkDuplicates({
        title: draft.title,
        sourceUrl: sourceUrl ? String(sourceUrl) : null,
      });

      res.json({ draft, duplicateMatches });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/knowledge/publications', requireAuth, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const publications = knowledgeService.listPublications(user, {
        status: req.query.status ? String(req.query.status) : undefined,
        subjectId: req.query.subjectId ? String(req.query.subjectId) : undefined,
        topicId: req.query.topicId ? String(req.query.topicId) : undefined,
        grade: req.query.grade ? String(req.query.grade) : undefined,
        search: req.query.search ? String(req.query.search) : undefined,
        bookmarkedOnly: req.query.bookmarkedOnly === 'true',
      });
      res.json({ publications });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/knowledge/publications/check-duplicates', requireTeacherOrAdmin, (req, res) => {
    const duplicates = knowledgeService.checkDuplicates({
      title: String(req.query.title || ''),
      sourceUrl: req.query.sourceUrl ? String(req.query.sourceUrl) : null,
      excludeId: req.query.excludeId ? String(req.query.excludeId) : undefined,
    });
    res.json({ duplicates });
  });

  app.post('/api/knowledge/publications', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const created = knowledgeService.createPublication(actor, req.body || {});
      res.status(201).json(created);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/knowledge/publications/:id', requireAuth, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const detail = knowledgeService.getPublicationDetail(user, String(req.params.id));
      res.json(detail);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.patch('/api/knowledge/publications/:id', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const updated = knowledgeService.updatePublication(
        actor,
        String(req.params.id),
        req.body || {}
      );
      res.json(updated);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/knowledge/publications/:id/transition', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const updated = knowledgeService.transitionPublicationStatus(
        actor,
        String(req.params.id),
        req.body || {}
      );
      res.json(updated);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/knowledge/publications/:id/correction', requireAdmin, (req, res) => {
    try {
      const admin = (req as AuthedRequest).authUser;
      const result = knowledgeService.issueCorrectionNotice(
        admin,
        String(req.params.id),
        req.body || {}
      );
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/knowledge/publications/:id/resources/upload', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const resource = knowledgeService.addUploadedResource(
        actor,
        String(req.params.id),
        req.body || {}
      );
      res.status(201).json({ resource });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/knowledge/publications/:id/resources/link', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const resource = knowledgeService.addLinkOrQuizResource(
        actor,
        String(req.params.id),
        req.body || {}
      );
      res.status(201).json({ resource });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.delete(
    '/api/knowledge/publications/:id/resources/:resourceId',
    requireTeacherOrAdmin,
    (req, res) => {
      try {
        const actor = (req as AuthedRequest).authUser;
        knowledgeService.removeResource(
          actor,
          String(req.params.id),
          String(req.params.resourceId)
        );
        res.json({ ok: true });
      } catch (err) {
        handleServiceError(res, err);
      }
    }
  );

  app.get('/api/knowledge/resources/:resourceId/download', requireAuth, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const resolved = knowledgeService.resolveAuthorizedDownload(
        user,
        String(req.params.resourceId)
      );
      res.setHeader('Content-Type', resolved.mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${resolved.fileName.replace(/"/g, '')}"`
      );
      res.sendFile(resolved.filePath);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/knowledge/publications/:id/distribute', requireAdmin, (req, res) => {
    try {
      const admin = (req as AuthedRequest).authUser;
      const result = knowledgeService.dispatchCampaign(
        admin,
        String(req.params.id),
        req.body || {}
      );
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/knowledge/campaigns/:campaignId/deliveries', requireAdmin, (req, res) => {
    res.json({
      deliveries: knowledgeService.listDeliveriesForCampaign(String(req.params.campaignId)),
    });
  });

  app.post('/api/knowledge/deliveries/:deliveryId/retry', requireAdmin, (req, res) => {
    try {
      const admin = (req as AuthedRequest).authUser;
      res.json(knowledgeService.retryDelivery(admin, String(req.params.deliveryId)));
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/knowledge/publications/:id/engage', requireAuth, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const { eventType, resourceId, metadata } = req.body || {};
      const result = knowledgeService.recordEngagementEvent(
        user,
        String(req.params.id),
        eventType || 'view',
        resourceId ? String(resourceId) : null,
        metadata || {}
      );
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/knowledge/discovery', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      res.json({ candidates: knowledgeService.listDiscoveryQueue(actor) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/knowledge/discovery', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const candidate = knowledgeService.addDiscoveryCandidate(actor, req.body || {});
      res.status(201).json({ candidate });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.patch('/api/knowledge/discovery/:id', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      knowledgeService.updateDiscoveryCandidateStatus(
        actor,
        String(req.params.id),
        req.body?.status === 'CONVERTED' ? 'CONVERTED' : 'DISMISSED'
      );
      res.json({ ok: true });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/knowledge/analytics', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      res.json(knowledgeService.getKnowledgeAnalytics(actor));
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  // --- Enhancement 03: Subject-Scoped Question Bank, Practice & Mock Assessment Builder ---
  app.post('/api/questions', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const quiz = assessmentService.createQuestionExtended(actor, req.body || {});
      res.status(201).json({ quiz });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.patch('/api/questions/:id', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const quiz = assessmentService.updateQuestionExtended(
        actor,
        String(req.params.id),
        req.body || {}
      );
      res.json({ quiz });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/questions/:id/transition', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const quiz = assessmentService.transitionQuestionStatus(
        actor,
        String(req.params.id),
        req.body || {}
      );
      res.json({ quiz });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/questions/:id/duplicate', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const quiz = assessmentService.duplicateQuestion(actor, String(req.params.id));
      res.status(201).json({ quiz });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/questions/:id/reviews', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const ctx = service.buildAuthContext(actor);
      const reviews = assessmentService.getQuestionReviewHistory(ctx, String(req.params.id));
      res.json({ reviews });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/questions/bulk-import', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const result = assessmentService.bulkImportQuestions(actor, req.body || {});
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/assessments/preview-selection', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const result = assessmentService.previewQuestionSelection(actor, req.body || {});
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/assessments', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const assessments = assessmentService.listAssessmentsScoped(actor, {
        kind: req.query.kind ? String(req.query.kind) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        subjectId: req.query.subjectId ? String(req.query.subjectId) : undefined,
        grade: req.query.grade ? String(req.query.grade) : undefined,
      });
      res.json({ assessments });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/assessments', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const assessment = assessmentService.createAssessment(actor, req.body || {});
      res.status(201).json({ assessment });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/assessments/:id', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const detail = assessmentService.getAssessmentDetailScoped(actor, String(req.params.id));
      res.json(detail);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.patch('/api/assessments/:id', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const assessment = assessmentService.updateDraftAssessment(
        actor,
        String(req.params.id),
        req.body || {}
      );
      res.json({ assessment });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/assessments/:id/transition', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const assessment = assessmentService.transitionAssessmentStatus(
        actor,
        String(req.params.id),
        req.body || {}
      );
      res.json({ assessment });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/assessments/:id/duplicate', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const assessment = assessmentService.duplicateAssessment(actor, String(req.params.id));
      res.status(201).json({ assessment });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/assessments/:id/new-version', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const assessment = assessmentService.createAssessmentNewVersion(actor, String(req.params.id));
      res.status(201).json({ assessment });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/assessments/:id/export', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const includeAnswerKey = req.query.includeAnswerKey === 'true';
      const exported = assessmentService.exportAssessmentPrintable(
        actor,
        String(req.params.id),
        includeAnswerKey
      );
      res.json(exported);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/assessments/:id/analytics', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const analytics = assessmentService.getAssessmentAnalytics(actor, String(req.params.id));
      res.json(analytics);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/assessments/:id/assign-followup', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const result = assessmentService.assignFollowUpFromAssessment(
        actor,
        String(req.params.id),
        req.body || {}
      );
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/assessment-attempts/:attemptId/grade', requireTeacherOrAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).authUser;
      const grades = Array.isArray(req.body?.grades) ? req.body.grades : [];
      const review = assessmentService.gradeManualAnswers(
        actor,
        String(req.params.attemptId),
        grades
      );
      res.json(review);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/student/assessments', requireAuth, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const assessments = assessmentService.listStudentAssessments(user);
      res.json({ assessments });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/assessments/:id/start', requireAuth, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const session = assessmentService.startOrResumeAssessmentAttempt(
        user,
        String(req.params.id)
      );
      res.json(session);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/assessments/:id/save-progress', requireAuth, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const result = assessmentService.saveAssessmentProgress(
        user,
        String(req.params.id),
        req.body || {}
      );
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/assessments/:id/check-answer', requireAuth, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const result = assessmentService.checkPracticeQuestionAnswer(
        user,
        String(req.params.id),
        req.body || {}
      );
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/assessments/:id/submit', requireAuth, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const result = assessmentService.submitAssessmentAttempt(
        user,
        String(req.params.id),
        req.body || {}
      );
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/assessment-attempts/:attemptId/review', requireAuth, (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const review = assessmentService.getAttemptReview(user, String(req.params.attemptId));
      res.json(review);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  // --- Enhancement 04: Secure Account Recovery, Identity Management & Google Authenticator ---
  app.post('/api/auth/logout', requireAuth, (req, res) => {
    const { authUser, authJti } = req as AuthedRequest;
    if (authJti) {
      const row = database.db
        .prepare('SELECT id FROM auth_sessions WHERE token_jti = ? AND user_id = ? AND revoked_at IS NULL')
        .get(authJti, authUser.id) as { id: string } | undefined;
      if (row) {
        identityService.revokeSession(authUser.id, row.id, 'user_logout');
      }
    }
    res.json({ ok: true });
  });

  app.post('/api/auth/recovery/request', rateLimitAuth('recovery-request', 10), (req, res) => {
    try {
      const { identifier, channel, resendChallengeId } = req.body || {};
      const result = identityService.requestRecoveryChallenge({
        identifier: String(identifier || ''),
        channel: channel === 'whatsapp' ? 'whatsapp' : 'email',
        resendChallengeId: resendChallengeId ? String(resendChallengeId) : undefined,
        ipAddress: getClientIp(req),
      });
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/auth/recovery/verify', rateLimitAuth('recovery-verify', 15), (req, res) => {
    try {
      const { challengeId, identifier, otpCode, totpCode, backupCode } = req.body || {};
      const result = identityService.verifyRecoveryChallenge({
        challengeId: String(challengeId || ''),
        identifier: identifier ? String(identifier) : undefined,
        otpCode: String(otpCode || ''),
        totpCode: totpCode ? String(totpCode) : undefined,
        backupCode: backupCode ? String(backupCode) : undefined,
        ipAddress: getClientIp(req),
      });
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/auth/recovery/reset-password', rateLimitAuth('recovery-reset', 10), (req, res) => {
    try {
      const { resetToken, newPassword, totpCode, backupCode } = req.body || {};
      const result = identityService.completePasswordReset({
        resetToken: String(resetToken || ''),
        newPassword: String(newPassword || ''),
        totpCode: totpCode ? String(totpCode) : undefined,
        backupCode: backupCode ? String(backupCode) : undefined,
        ipAddress: getClientIp(req),
      });
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/auth/recovery/authenticator', rateLimitAuth('recovery-totp', 10), async (req, res) => {
    try {
      const { identifier, password, mode, backupCode, reason } = req.body || {};
      const result = await identityService.recoverAuthenticator({
        identifier: String(identifier || ''),
        password: String(password || ''),
        mode: mode === 'backup_code' ? 'backup_code' : 'admin_request',
        backupCode: backupCode ? String(backupCode) : undefined,
        reason: reason ? String(reason) : undefined,
        ipAddress: getClientIp(req),
      });
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/auth/admin-recovery', rateLimitAuth('admin-recovery', 5), (req, res) => {
    try {
      const { identifier, adminRecoveryKey, newPassword, verificationNote } = req.body || {};
      const result = identityService.completeProtectedAdminRecovery({
        identifier: String(identifier || ''),
        adminRecoveryKey: String(adminRecoveryKey || ''),
        newPassword: String(newPassword || ''),
        verificationNote: verificationNote ? String(verificationNote) : undefined,
        ipAddress: getClientIp(req),
      });
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/account/security', requireAuth, (req, res) => {
    try {
      const { authUser, authJti } = req as AuthedRequest;
      res.json(identityService.getAccountSecurityStatus(authUser, authJti));
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/account/password/change', requireAuth, (req, res) => {
    try {
      const { authUser, authJti } = req as AuthedRequest;
      const { currentPassword, newPassword, totpCode, revokeOtherSessions } = req.body || {};
      const result = identityService.changePassword(authUser, {
        currentPassword: String(currentPassword || ''),
        newPassword: String(newPassword || ''),
        totpCode: totpCode ? String(totpCode) : undefined,
        revokeOtherSessions: revokeOtherSessions !== false,
        currentJti: authJti,
        ipAddress: getClientIp(req),
      });
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.patch('/api/account/username', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const { newUsername, currentPassword, totpCode } = req.body || {};
      const updated = identityService.changeUsername(authUser, {
        newUsername: String(newUsername || ''),
        currentPassword: currentPassword !== undefined ? String(currentPassword) : undefined,
        totpCode: totpCode ? String(totpCode) : undefined,
        ipAddress: getClientIp(req),
      });
      res.json({ user: service.sanitizeUser(updated) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/account/contacts/request-change', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const {
        channel,
        newContact,
        currentPassword,
        totpCode,
        lostOldContact,
        verificationNotes,
      } = req.body || {};
      const result = identityService.requestContactChange(authUser, {
        channel: channel === 'whatsapp' ? 'whatsapp' : 'email',
        newContact: String(newContact || ''),
        currentPassword: String(currentPassword || ''),
        totpCode: totpCode ? String(totpCode) : undefined,
        lostOldContact: Boolean(lostOldContact),
        verificationNotes: verificationNotes ? String(verificationNotes) : undefined,
        ipAddress: getClientIp(req),
      });
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/account/contacts/confirm-change', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const { requestId, otpCode } = req.body || {};
      const updated = identityService.confirmContactChange(authUser, {
        requestId: String(requestId || ''),
        otpCode: String(otpCode || ''),
        ipAddress: getClientIp(req),
      });
      res.json({ user: service.sanitizeUser(updated) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/account/totp/enroll/start', requireAuth, async (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const { targetStudentId, currentPassword, currentTotpCode } = req.body || {};
      const setup = await identityService.startTotpEnrollment(authUser, {
        targetStudentId: targetStudentId ? String(targetStudentId) : undefined,
        currentPassword: currentPassword ? String(currentPassword) : undefined,
        currentTotpCode: currentTotpCode ? String(currentTotpCode) : undefined,
        ipAddress: getClientIp(req),
      });
      res.json(setup);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/account/totp/enroll/confirm', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const { code, targetStudentId } = req.body || {};
      const result = identityService.confirmTotpEnrollment(authUser, {
        code: String(code || ''),
        targetStudentId: targetStudentId ? String(targetStudentId) : undefined,
        ipAddress: getClientIp(req),
      });
      const updated = service.getUserById(authUser.id)!;
      res.json({ ...result, user: service.sanitizeUser(updated) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/account/totp/backup-codes/regenerate', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const { currentPassword, totpCode } = req.body || {};
      const result = identityService.regenerateBackupCodes(authUser, {
        currentPassword: String(currentPassword || ''),
        totpCode: String(totpCode || ''),
        ipAddress: getClientIp(req),
      });
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/account/guardian/recover-child-totp', requireAuth, async (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const { studentId, parentPassword, parentTotpCode } = req.body || {};
      const result = await identityService.guardianRecoverChildTotp(authUser, {
        studentId: String(studentId || ''),
        parentPassword: String(parentPassword || ''),
        parentTotpCode: parentTotpCode ? String(parentTotpCode) : undefined,
        ipAddress: getClientIp(req),
      });
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.delete('/api/account/sessions/:id', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      identityService.revokeSession(authUser.id, String(req.params.id), 'user_revoked');
      res.json({ ok: true });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/account/sessions/revoke-others', requireAuth, (req, res) => {
    try {
      const { authUser, authJti } = req as AuthedRequest;
      const revokedCount = identityService.revokeOtherSessions(
        authUser.id,
        authJti,
        'user_revoked_other_devices'
      );
      res.json({ ok: true, revokedCount });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/admin/recovery-requests', requireAdmin, (req, res) => {
    try {
      const admin = (req as AuthedRequest).authUser;
      res.json({ requests: identityService.listAdminRecoveryRequests(admin) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/admin/recovery-requests/:id/review', requireAdmin, (req, res) => {
    try {
      const admin = (req as AuthedRequest).authUser;
      const { decision, notes, newContactOverride } = req.body || {};
      const updated = identityService.reviewAdminRecoveryRequest(
        admin,
        String(req.params.id),
        {
          decision: decision === 'REJECT' ? 'REJECT' : 'APPROVE',
          notes: String(notes || ''),
          newContactOverride: newContactOverride ? String(newContactOverride) : undefined,
        }
      );
      res.json({ request: updated });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  // =========================================================================
  // Enhancement 05: Parent Learning Intelligence, Teaching Guidance & Smart Timetables
  // =========================================================================

  app.get('/api/guardian-links', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const links = parentIntelligenceService.getLinkedStudents(authUser);
      const guardians =
        authUser.role === 'admin' ? parentIntelligenceService.listGuardianAccounts() : undefined;
      res.json({ links, guardians });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/guardian-links', requireAdmin, (req, res) => {
    try {
      const admin = (req as AuthedRequest).authUser;
      const link = parentIntelligenceService.createOrVerifyGuardianLink(admin, req.body || {});
      res.status(201).json({ link });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.patch('/api/guardian-links/:id', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const link = parentIntelligenceService.updateGuardianLinkPermissions(
        authUser,
        String(req.params.id),
        req.body || {}
      );
      res.json({ link });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/parent/students/:studentId/reports', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const result = parentIntelligenceService.listStudentReports(
        authUser,
        String(req.params.studentId)
      );
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/parent/reports/:reportId', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const detail = parentIntelligenceService.getReportDetail(
        authUser,
        String(req.params.reportId)
      );
      res.json(detail);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/parent/reports/:reportId/export.html', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const { filename, html } = parentIntelligenceService.exportReportHtml(
        authUser,
        String(req.params.reportId)
      );
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(html);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/parent/reports/:reportId/export.pdf', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const { filename, pdf } = parentIntelligenceService.exportReportPdf(
        authUser,
        String(req.params.reportId)
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdf);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/parent/reports/:reportId/dispatch', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const { channels } = req.body || {};
      const result = parentIntelligenceService.resendReport(
        authUser,
        String(req.params.reportId),
        Array.isArray(channels) ? channels : undefined
      );
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/teacher/parent-support-insights', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json(parentIntelligenceService.getTeacherParentSupportInsights(authUser));
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/schedule/questions/preview', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const { studentId, filters } = req.body || {};
      res.json(
        parentIntelligenceService.previewFilteredQuestions(authUser, {
          studentId: studentId ? String(studentId) : undefined,
          filters: filters || { subjectIds: [] },
        })
      );
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/timetable-presets', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({ presets: parentIntelligenceService.listTimetablePresets(authUser) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/timetable-presets', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const preset = parentIntelligenceService.createTimetablePreset(authUser, req.body || {});
      res.status(201).json({ preset });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.patch('/api/timetable-presets/:id', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const preset = parentIntelligenceService.updateTimetablePreset(
        authUser,
        String(req.params.id),
        req.body || {}
      );
      res.json({ preset });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/timetable-presets/:id/transition', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const action = String(req.body?.action || 'submit_review') as
        | 'submit_review'
        | 'publish'
        | 'archive';
      const preset = parentIntelligenceService.transitionTimetablePresetStatus(
        authUser,
        String(req.params.id),
        action
      );
      res.json({ preset });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/timetable-presets/:id/preview-apply', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const preview = parentIntelligenceService.previewPresetApplication(authUser, {
        presetId: String(req.params.id),
        studentId: String(req.body?.studentId || ''),
        startDate: String(req.body?.startDate || new Date().toISOString().slice(0, 10)),
        endDate: req.body?.endDate ? String(req.body.endDate) : undefined,
        timezone: req.body?.timezone ? String(req.body.timezone) : 'Asia/Colombo',
        exceptionDates: Array.isArray(req.body?.exceptionDates) ? req.body.exceptionDates : [],
      });
      res.json(preview);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/timetable-presets/:id/apply', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const applied = parentIntelligenceService.applyPresetToStudent(authUser, {
        presetId: String(req.params.id),
        studentId: String(req.body?.studentId || ''),
        startDate: String(req.body?.startDate || new Date().toISOString().slice(0, 10)),
        endDate: req.body?.endDate ? String(req.body.endDate) : undefined,
        timezone: req.body?.timezone ? String(req.body.timezone) : 'Asia/Colombo',
        customTitle: req.body?.customTitle ? String(req.body.customTitle) : undefined,
        exceptionDates: Array.isArray(req.body?.exceptionDates) ? req.body.exceptionDates : [],
        skipConflicts: Boolean(req.body?.skipConflicts),
      });
      let wellbeingRecord = null;
      if (applied.sessions.length > 0) {
        const validation = wellbeingService.validatePreSchedule(authUser, {
          studentId: applied.timetable.studentId,
          proposedSlots: applied.sessions.map((s) => ({
            localDate: s.scheduledStartUtc.slice(0, 10),
            startUtc: s.scheduledStartUtc,
            endUtc: s.scheduledEndUtc,
            durationMinutes: s.durationMinutes,
            title: s.title,
          })),
        });
        if (validation.severity !== 'nominal') {
          wellbeingRecord = wellbeingService.recordPreScheduleValidationDecision(authUser, {
            studentId: applied.timetable.studentId,
            validation,
            decision: req.body?.wellbeingDecision || 'proceeded_with_acknowledgement',
            decisionNotes: req.body?.wellbeingDecisionNotes,
            timetableId: applied.timetable.id,
          });
        }
      }
      res.status(201).json({ ...applied, wellbeingRecord });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/schedule/students/:studentId/dashboard', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json(
        parentIntelligenceService.getStudentScheduleDashboard(
          authUser,
          String(req.params.studentId)
        )
      );
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/timetables/preview', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const preview = parentIntelligenceService.previewCustomTimetable(authUser, req.body || {});
      const wellbeing =
        req.body?.studentId && Array.isArray(preview.occurrences)
          ? wellbeingService.validatePreSchedule(authUser, {
              studentId: String(req.body.studentId),
              proposedSlots: preview.occurrences.map((o) => ({
                localDate: o.localDate,
                startUtc: o.startUtc,
                endUtc: o.endUtc,
                durationMinutes: Number(req.body.durationMinutes || 20),
                title: String(req.body.title || ''),
              })),
              subjectIds: req.body?.filterCriteria?.subjectIds,
            })
          : null;
      res.json({ ...preview, wellbeing });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/timetables', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const created = parentIntelligenceService.createCustomTimetable(authUser, req.body || {});
      let wellbeingRecord = null;
      if (created.sessions.length > 0) {
        const validation = wellbeingService.validatePreSchedule(authUser, {
          studentId: created.timetable.studentId,
          proposedSlots: created.sessions.map((s) => ({
            localDate: s.scheduledStartUtc.slice(0, 10),
            startUtc: s.scheduledStartUtc,
            endUtc: s.scheduledEndUtc,
            durationMinutes: s.durationMinutes,
            title: s.title,
          })),
          subjectIds: req.body?.filterCriteria?.subjectIds,
        });
        if (validation.severity !== 'nominal') {
          wellbeingRecord = wellbeingService.recordPreScheduleValidationDecision(authUser, {
            studentId: created.timetable.studentId,
            validation,
            decision: req.body?.wellbeingDecision || 'proceeded_with_acknowledgement',
            decisionNotes: req.body?.wellbeingDecisionNotes,
            subjectIds: req.body?.filterCriteria?.subjectIds,
            timetableId: created.timetable.id,
          });
        }
      }
      res.status(201).json({ ...created, wellbeingRecord });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.patch('/api/timetables/:id/status', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const action = String(req.body?.action || 'pause') as 'pause' | 'resume' | 'cancel';
      const result = parentIntelligenceService.updateTimetableStatus(
        authUser,
        String(req.params.id),
        action
      );
      res.json(result);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.patch('/api/scheduled-sessions/:id/reschedule', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const session = parentIntelligenceService.rescheduleSession(
        authUser,
        String(req.params.id),
        req.body || {}
      );
      res.json({ session });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.patch('/api/scheduled-sessions/:id/status', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const action = String(req.body?.action || 'pause') as 'pause' | 'resume' | 'cancel';
      const session = parentIntelligenceService.updateSessionStatus(
        authUser,
        String(req.params.id),
        action
      );
      res.json({ session });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/scheduled-sessions/:id/start', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json(
        parentIntelligenceService.startScheduledSession(authUser, String(req.params.id))
      );
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/scheduled-sessions/:id/complete', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const session = parentIntelligenceService.completeScheduledSession(
        authUser,
        String(req.params.id),
        req.body?.linkedAttemptId ? String(req.body.linkedAttemptId) : null
      );
      res.json({ session });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.put('/api/reminder-preferences/:studentId', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const preferences = parentIntelligenceService.updateReminderPreferences(
        authUser,
        String(req.params.studentId),
        req.body || {}
      );
      res.json({ preferences });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/scheduler/run-sweep', requireAdmin, (_req, res) => {
    try {
      res.json(parentIntelligenceService.runSchedulerSweep());
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  // =========================================================================
  // Enhancement 06: Child Learning Wellbeing, Study-Time Intelligence & Safeguarding
  // =========================================================================

  app.post('/api/wellbeing/activity/events', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const events = Array.isArray(req.body?.events) ? req.body.events : req.body ? [req.body] : [];
      res.json(wellbeingService.ingestActivityEvents(authUser, events));
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/wellbeing/students/:studentId/activity', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const days = Number(req.query.days || 7);
      res.json(wellbeingService.getStudentStudyTimeAnalytics(authUser, String(req.params.studentId), days));
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/wellbeing/rules', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({ ruleSets: wellbeingService.listWellbeingRuleSets(authUser) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/wellbeing/rules', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const created = wellbeingService.createOrProposeRule(authUser, req.body || {});
      res.status(201).json(created);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/wellbeing/rules/versions/:versionId/approve', requireAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        version: wellbeingService.approveWellbeingRuleVersion(authUser, String(req.params.versionId)),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/wellbeing/schedule/validate', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json(wellbeingService.validatePreSchedule(authUser, req.body || {}));
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/wellbeing/schedule/decision', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.status(201).json(wellbeingService.recordPreScheduleValidationDecision(authUser, req.body || {}));
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/wellbeing/students/:studentId/warnings', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        warnings: wellbeingService.listStudentWarnings(authUser, String(req.params.studentId)),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/wellbeing/warnings/:warningId/acknowledge', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        warning: wellbeingService.acknowledgeWarningDecision(
          authUser,
          String(req.params.warningId),
          req.body?.decision || 'adjusted',
          req.body?.notes
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/wellbeing/cases', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        cases: wellbeingService.listWellbeingCases(authUser, {
          status: req.query.status ? String(req.query.status) : undefined,
          priority: req.query.priority ? String(req.query.priority) : undefined,
          studentId: req.query.studentId ? String(req.query.studentId) : undefined,
        }),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/wellbeing/cases/:caseId', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json(wellbeingService.getWellbeingCaseDetail(authUser, String(req.params.caseId)));
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/wellbeing/cases/:caseId/assign', requireAdmin, (req, res) => {
    try {
      const admin = (req as AuthedRequest).authUser;
      res.json({
        caseRecord: wellbeingService.assignWellbeingCase(
          admin,
          String(req.params.caseId),
          String(req.body?.assignedToUserId || ''),
          req.body?.reason
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/wellbeing/cases/:caseId/transition', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        caseRecord: wellbeingService.transitionWellbeingCase(
          authUser,
          String(req.params.caseId),
          req.body || {}
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/wellbeing/cases/:caseId/contacts', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.status(201).json({
        contact: wellbeingService.createParentContactRecord(
          authUser,
          String(req.params.caseId),
          req.body || {}
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.patch('/api/wellbeing/contacts/:noteId', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        contact: wellbeingService.updateDraftParentContactRecord(
          authUser,
          String(req.params.noteId),
          req.body || {}
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/wellbeing/contacts/:noteId/finalize', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        contact: wellbeingService.finalizeParentContactRecord(authUser, String(req.params.noteId)),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/wellbeing/contacts/:noteId/amend', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.status(201).json({
        contact: wellbeingService.amendParentContactRecord(
          authUser,
          String(req.params.noteId),
          req.body || {}
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/wellbeing/cases/:caseId/followups', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.status(201).json({
        action: wellbeingService.addFollowupAction(
          authUser,
          String(req.params.caseId),
          req.body || {}
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.patch('/api/wellbeing/followups/:actionId', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        action: wellbeingService.updateFollowupActionStatus(
          authUser,
          String(req.params.actionId),
          req.body?.status || 'COMPLETED',
          req.body?.completionNotes
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/safeguarding/reviews', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({ reviews: wellbeingService.listSafeguardingReviews(authUser) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/safeguarding/cases/:caseId/review', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.status(201).json({
        review: wellbeingService.initiateOrUpdateSafeguardingReview(
          authUser,
          String(req.params.caseId),
          req.body || {}
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/safeguarding/reviews/:reviewId/approve', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        review: wellbeingService.approveSafeguardingReview(
          authUser,
          String(req.params.reviewId),
          req.body || {}
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/audit-documents', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const studentId = req.query.studentId ? String(req.query.studentId) : undefined;
      res.json({ documents: wellbeingService.listAuditDocuments(authUser, studentId) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/audit-documents/generate', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.status(201).json({
        document: wellbeingService.generateAuditDocument(authUser, req.body || {}),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/audit-documents/access-logs', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const docId = req.query.documentId ? String(req.query.documentId) : undefined;
      res.json({ logs: wellbeingService.listAuditDocumentAccessLogs(authUser, docId) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/audit-documents/:docId', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({ document: wellbeingService.getAuditDocumentDetail(authUser, String(req.params.docId)) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/audit-documents/:docId/export.pdf', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const { filename, pdf } = wellbeingService.exportAuditDocumentPdf(
        authUser,
        String(req.params.docId)
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdf);
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  // --- Enhancement 07: Parent Academic Routine Builder, Weighted Learning Allocation & Teacher Evaluation ---
  app.get('/api/routines/skills', requireAuth, (_req, res) => {
    try {
      res.json(routineService.getSkillTaxonomy());
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/routines/question-skills', requireTeacherOrAdmin, (req, res) => {
    try {
      const qId = req.query.questionId ? String(req.query.questionId) : undefined;
      res.json({ mappings: routineService.listQuestionSkillMappings(qId) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.put('/api/routines/question-skills/:questionId', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        mapping: routineService.updateQuestionSkillMappings(
          authUser,
          String(req.params.questionId),
          req.body || {}
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/routines/preview-validation', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        validation: routineService.previewRoutineValidation(authUser, req.body || {}),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/routines', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const studentId = req.query.studentId ? String(req.query.studentId) : undefined;
      res.json({ routines: routineService.listRoutines(authUser, { studentId }) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/routines/:id', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({ detail: routineService.getRoutineDetail(authUser, String(req.params.id)) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/routines', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.status(201).json({ detail: routineService.createRoutine(authUser, req.body || {}) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.put('/api/routines/:id', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        detail: routineService.updateRoutine(authUser, String(req.params.id), req.body || {}),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/routines/:id/submit', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        detail: routineService.submitRoutineForReview(authUser, String(req.params.id)),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/routines/:id/teacher-evaluate', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        detail: routineService.submitTeacherEvaluation(
          authUser,
          String(req.params.id),
          req.body || {}
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/routines/:id/admin-evaluate', requireAdmin, (req, res) => {
    try {
      const admin = (req as AuthedRequest).authUser;
      res.json({
        detail: routineService.submitAdminEvaluation(
          admin,
          String(req.params.id),
          req.body || {}
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/routines/:id/activate', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json(routineService.activateRoutine(authUser, String(req.params.id), req.body || {}));
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.patch('/api/routines/:id/lifecycle', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        detail: routineService.transitionRoutineLifecycle(
          authUser,
          String(req.params.id),
          req.body?.action || 'pause'
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/routines/:id/adaptive-evaluate', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json(routineService.evaluateAdaptiveAdjustments(authUser, String(req.params.id)));
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/routines/:id/performance', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        performance: routineService.getRoutinePerformanceSummary(
          authUser,
          String(req.params.id)
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  // --- Enhancement 08: Gamified Learning Roadmaps, Progressive Levels, Interactive Missions & Rewards ---
  app.get('/api/roadmaps', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({ roadmaps: roadmapService.listRoadmaps(authUser) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/roadmaps/dashboard', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const studentId = req.query.studentId ? String(req.query.studentId) : undefined;
      res.json({ dashboard: roadmapService.getStudentDashboard(authUser, studentId) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/roadmaps/reports/:studentId', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const roadmapId = req.query.roadmapId ? String(req.query.roadmapId) : undefined;
      res.json({
        reports: roadmapService.getRoadmapProgressReport(
          authUser,
          String(req.params.studentId),
          roadmapId
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/roadmaps/rewards/:rewardDefId/equip', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        unlockedRewards: roadmapService.equipReward(
          authUser,
          String(req.params.rewardDefId)
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/roadmaps/schedule-mission', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.status(201).json(roadmapService.scheduleMissionToTimetable(authUser, req.body || {}));
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.get('/api/roadmaps/:id', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const studentId = req.query.studentId ? String(req.query.studentId) : undefined;
      res.json({
        detail: roadmapService.getRoadmapDetail(authUser, String(req.params.id), studentId),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/roadmaps', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.status(201).json({ detail: roadmapService.createRoadmap(authUser, req.body || {}) });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/roadmaps/:id/stages', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.status(201).json({
        stage: roadmapService.createStage(authUser, String(req.params.id), req.body || {}),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/roadmaps/:id/levels', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.status(201).json({
        detail: roadmapService.upsertLevel(authUser, String(req.params.id), req.body || {}),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/roadmaps/levels/:levelId/missions', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.status(201).json({
        detail: roadmapService.upsertMission(authUser, String(req.params.levelId), req.body || {}),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/roadmaps/:id/transition', requireTeacherOrAdmin, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        detail: roadmapService.transitionRoadmapStatus(
          authUser,
          String(req.params.id),
          req.body || {}
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/roadmaps/missions/:missionId/start', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      const studentId = req.body?.studentId ? String(req.body.studentId) : undefined;
      res.status(201).json(
        roadmapService.startMission(authUser, String(req.params.missionId), studentId)
      );
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  app.post('/api/roadmaps/missions/:missionId/complete', requireAuth, (req, res) => {
    try {
      const { authUser } = req as AuthedRequest;
      res.json({
        result: roadmapService.completeMission(
          authUser,
          String(req.params.missionId),
          req.body || {}
        ),
      });
    } catch (err) {
      handleServiceError(res, err);
    }
  });

  // Periodic scheduler for future-scheduled publications & study session reminders (idempotent)
  const scheduleTimer = setInterval(() => {
    try {
      knowledgeService.processScheduledPublications();
      parentIntelligenceService.runSchedulerSweep();
    } catch {
      // ignore background tick error
    }
  }, 30_000);
  scheduleTimer.unref();

  // --- Vite Dev / Static Prod Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`මං 5හේ Server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
