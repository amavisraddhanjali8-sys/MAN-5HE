import crypto from 'node:crypto';
import QRCode from 'qrcode';
import {
  buildOtpAuthUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateBackupCodes,
  generateEmailOtp,
  generateTotpSecret,
  getTotpEncryptionMasterKey,
  hashOtpCode,
  hashPassword,
  hashSecretToken,
  maskEmail,
  maskPhoneNumber,
  normalizeEmail,
  normalizeWhatsAppNumber,
  verifyOtpHash,
  verifyPassword,
  verifySecretTokenHash,
  verifyTotpCodeWithStep,
  validatePasswordPolicy,
  validateUsername,
} from '../lib/security.ts';
import {
  buildPasswordRecoveryEmailHtml,
  buildSecurityAlertEmailHtml,
  buildWhatsAppRecoveryTemplatePayload,
  buildWhatsAppSecurityAlert,
} from '../lib/notifications.ts';
import type {
  AccountSecurityStatus,
  AdminRecoveryRequestRecord,
  AuthSessionRecord,
  ContactChangeRequestRecord,
  RecoveryChannel,
  SecurityEventRecord,
  TotpEnrollmentSummary,
  UserAccount,
  UserRole,
  VerifiedRecoveryContact,
} from '../lib/types.ts';
import { AcademicService, HttpError } from './academicService.ts';
import type { Man5heDatabase } from './db.ts';

export interface DispatchedOtpEvent {
  userId: string;
  channel: RecoveryChannel;
  purpose: string;
  destination: string;
  otpCode: string;
  expiresAt: string;
  emailSubject?: string;
  emailHtml?: string;
  whatsappPayload?: ReturnType<typeof buildWhatsAppRecoveryTemplatePayload>;
}

export interface IdentitySecurityOptions {
  nowFn?: () => number;
  onDispatchOtp?: (event: DispatchedOtpEvent) => void;
  sessionSecret?: string;
  supportEmail?: string;
}

const SENSITIVE_META_PATTERN = /otp|code|password|hash|secret|token|backup/i;

function sanitizeMetadata(meta: Record<string, unknown> = {}): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_META_PATTERN.test(k)) {
      clean[k] = '[REDACTED]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      clean[k] = sanitizeMetadata(v as Record<string, unknown>);
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

function getRecoveryOtpTtlSeconds(): number {
  return Math.max(60, Number(process.env.RECOVERY_OTP_TTL_SECONDS || 300));
}

function getRecoveryResendCooldownSeconds(): number {
  return Math.max(5, Number(process.env.RECOVERY_RESEND_COOLDOWN_SECONDS || 30));
}

function getUsernameChangeCooldownHours(): number {
  return Math.max(0, Number(process.env.USERNAME_CHANGE_COOLDOWN_HOURS ?? 24));
}

export class IdentitySecurityService {
  private readonly dbWrapper: Man5heDatabase;
  private readonly academicService: AcademicService;
  private readonly nowFn: () => number;
  private readonly onDispatchOtp?: (event: DispatchedOtpEvent) => void;
  private readonly sessionSecret: string;
  private readonly supportEmail: string;
  private readonly identifierRateTracker = new Map<string, number[]>();

  constructor(
    dbWrapper: Man5heDatabase,
    academicService: AcademicService,
    options: IdentitySecurityOptions = {}
  ) {
    this.dbWrapper = dbWrapper;
    this.academicService = academicService;
    this.nowFn = options.nowFn || (() => Date.now());
    this.onDispatchOtp = options.onDispatchOtp;
    this.sessionSecret =
      options.sessionSecret ||
      process.env.AUTH_SESSION_SECRET ||
      'man5he-dev-session-secret-change-in-prod';
    this.supportEmail = options.supportEmail || process.env.EMAIL_FROM_ADDRESS || 'support@man5he.lk';
  }

  private get db() {
    return this.dbWrapper.db;
  }

  private nowMs(): number {
    return this.nowFn();
  }

  private nowIso(): string {
    return new Date(this.nowMs()).toISOString();
  }

  // --- Security Events & Alerts ---
  public recordSecurityEvent(params: {
    userId: string | null;
    actorId?: string | null;
    eventType: string;
    severity?: 'info' | 'warning' | 'critical';
    channel?: string | null;
    ipAddress?: string | null;
    summary: string;
    metadata?: Record<string, unknown>;
  }): void {
    const cleanMeta = sanitizeMetadata(params.metadata || {});
    this.db
      .prepare(
        `INSERT INTO security_events (
          id, user_id, actor_id, event_type, severity, channel, ip_address, summary, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `SEC-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
        params.userId,
        params.actorId || params.userId,
        params.eventType,
        params.severity || 'info',
        params.channel || null,
        params.ipAddress || null,
        params.summary,
        JSON.stringify(cleanMeta),
        this.nowIso()
      );
  }

  private dispatchSecurityAlert(params: {
    user: UserAccount;
    headline: string;
    summary: string;
    overrideEmail?: string;
    overrideWhatsapp?: string;
    dedupePrefix: string;
  }): void {
    const nowIso = this.nowIso();
    const targetEmail = params.overrideEmail || params.user.email;
    const targetWhatsapp = params.overrideWhatsapp || params.user.whatsappNumber;

    // 1. In-app notification
    this.academicService.insertNotificationRow({
      recipientUserId: params.user.id,
      recipientRole: params.user.role,
      channel: 'in_app',
      category: 'security_alert',
      title: params.headline,
      body: params.summary,
      dedupeKey: `${params.dedupePrefix}-inapp-${crypto.randomBytes(4).toString('hex')}`,
      deliveryStatus: 'delivered',
    });

    // 2. Email alert (if verified or overridden to previous verified email)
    if (targetEmail && (params.overrideEmail || params.user.emailVerified)) {
      this.academicService.recordEmailLog({
        toEmail: targetEmail,
        subject: `Security Alert: ${params.headline} · මං 5හේ`,
        category: 'security_alert',
        htmlBody: buildSecurityAlertEmailHtml({
          recipientName: params.user.name,
          headline: params.headline,
          summary: params.summary,
          actionTimeIso: nowIso,
          supportEmail: this.supportEmail,
        }),
      });
    }

    // 3. WhatsApp alert (only if verified contact exists, no sensitive secrets)
    if (targetWhatsapp && (params.overrideWhatsapp || params.user.whatsappVerified !== false)) {
      this.academicService.recordWhatsAppLog({
        toNumber: targetWhatsapp,
        category: 'security_alert',
        messageText: buildWhatsAppSecurityAlert({
          headline: params.headline,
          summary: params.summary,
        }),
        deliveryStatus: 'delivered',
      });
    }
  }

  // --- Session Lifecycle ---
  public createAuthSession(params: {
    userId: string;
    tokenJti: string;
    deviceLabel?: string;
    ipAddress?: string;
    userAgent?: string;
    expiresAtMs: number;
  }): AuthSessionRecord {
    const now = this.nowIso();
    const id = `SES-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const deviceLabel = params.deviceLabel || this.parseDeviceLabel(params.userAgent || '');
    const expiresAt = new Date(params.expiresAtMs).toISOString();

    this.db
      .prepare(
        `INSERT INTO auth_sessions (
          id, user_id, token_jti, device_label, ip_address, user_agent,
          issued_at, last_seen_at, expires_at, revoked_at, revoke_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(
        id,
        params.userId,
        params.tokenJti,
        deviceLabel,
        params.ipAddress || 'unknown',
        (params.userAgent || '').slice(0, 220),
        now,
        now,
        expiresAt
      );

    return {
      id,
      userId: params.userId,
      tokenJti: params.tokenJti,
      deviceLabel,
      ipAddress: params.ipAddress || 'unknown',
      userAgent: (params.userAgent || '').slice(0, 220),
      issuedAt: now,
      lastSeenAt: now,
      expiresAt,
      revokedAt: null,
      revokeReason: null,
    };
  }

  private parseDeviceLabel(ua: string): string {
    const lower = ua.toLowerCase();
    if (lower.includes('iphone') || lower.includes('ipad')) return 'iOS Safari / Mobile';
    if (lower.includes('android')) return 'Android Mobile Browser';
    if (lower.includes('edg')) return 'Microsoft Edge';
    if (lower.includes('chrome')) return 'Chrome Desktop Browser';
    if (lower.includes('firefox')) return 'Firefox Desktop Browser';
    if (lower.includes('safari')) return 'Safari Browser';
    return 'Web Browser Session';
  }

  public isSessionValid(userId: string, tokenJti?: string): boolean {
    if (!tokenJti) return false;
    const row = this.db
      .prepare('SELECT id, expires_at, revoked_at FROM auth_sessions WHERE token_jti = ? AND user_id = ?')
      .get(tokenJti, userId) as
      | { id: string; expires_at: string; revoked_at: string | null }
      | undefined;
    if (!row) return false;
    if (row.revoked_at) return false;
    if (Date.parse(row.expires_at) <= this.nowMs()) return false;

    this.db
      .prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?')
      .run(this.nowIso(), row.id);
    return true;
  }

  public listSessions(userId: string, currentJti?: string): AuthSessionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM auth_sessions WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT 25')
      .all(userId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      tokenJti: String(r.token_jti),
      deviceLabel: String(r.device_label),
      ipAddress: String(r.ip_address),
      userAgent: String(r.user_agent),
      issuedAt: String(r.issued_at),
      lastSeenAt: String(r.last_seen_at),
      expiresAt: String(r.expires_at),
      revokedAt: r.revoked_at ? String(r.revoked_at) : null,
      revokeReason: r.revoke_reason ? String(r.revoke_reason) : null,
      isCurrent: currentJti ? String(r.token_jti) === currentJti : false,
    }));
  }

  public revokeSession(userId: string, sessionId: string, reason = 'user_revoked'): void {
    const res = this.db
      .prepare(
        'UPDATE auth_sessions SET revoked_at = ?, revoke_reason = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL'
      )
      .run(this.nowIso(), reason, sessionId, userId);
    if (res.changes === 0) {
      throw new HttpError(404, 'Active session not found.');
    }
    this.recordSecurityEvent({
      userId,
      eventType: 'SESSION_REVOKED',
      severity: 'info',
      summary: `Revoked session ${sessionId} (${reason}).`,
      metadata: { sessionId, reason },
    });
  }

  public revokeOtherSessions(userId: string, keepJti?: string, reason = 'revoke_others'): number {
    const res = keepJti
      ? this.db
          .prepare(
            'UPDATE auth_sessions SET revoked_at = ?, revoke_reason = ? WHERE user_id = ? AND token_jti != ? AND revoked_at IS NULL'
          )
          .run(this.nowIso(), reason, userId, keepJti)
      : this.db
          .prepare(
            'UPDATE auth_sessions SET revoked_at = ?, revoke_reason = ? WHERE user_id = ? AND revoked_at IS NULL'
          )
          .run(this.nowIso(), reason, userId);
    return Number(res.changes || 0);
  }

  public revokeAllSessions(userId: string, reason = 'security_reset'): number {
    const res = this.db
      .prepare(
        'UPDATE auth_sessions SET revoked_at = ?, revoke_reason = ? WHERE user_id = ? AND revoked_at IS NULL'
      )
      .run(this.nowIso(), reason, userId);
    return Number(res.changes || 0);
  }

  // --- Verified Contact Lookup ---
  private getPrimaryVerifiedContact(user: UserAccount, channel: RecoveryChannel): string | null {
    const row = this.db
      .prepare(
        `SELECT contact_value FROM verified_recovery_contacts
         WHERE user_id = ? AND channel = ? AND verified = 1
         ORDER BY is_primary DESC, updated_at DESC LIMIT 1`
      )
      .get(user.id, channel) as { contact_value: string } | undefined;

    if (row?.contact_value) return row.contact_value;
    if (channel === 'email' && user.emailVerified && user.email) {
      return user.email.toLowerCase();
    }
    if (channel === 'whatsapp' && user.whatsappVerified !== false && user.whatsappNumber) {
      return user.whatsappNumber;
    }
    return null;
  }

  // --- Shared Email & WhatsApp Password Recovery Engine ---
  private enforceRecoveryRateLimit(rateKey: string): void {
    const now = this.nowMs();
    const cooldownMs = getRecoveryResendCooldownSeconds() * 1000;
    const windowMs = 15 * 60 * 1000;
    const prev = (this.identifierRateTracker.get(rateKey) || []).filter((t) => now - t < windowMs);
    if (prev.length > 0 && now - prev[prev.length - 1] < cooldownMs) {
      throw new HttpError(
        429,
        `Please wait ${getRecoveryResendCooldownSeconds()} seconds before requesting another recovery code.`
      );
    }
    if (prev.length >= 4) {
      throw new HttpError(
        429,
        'Maximum recovery code requests reached for this window. Please try again later.'
      );
    }
    prev.push(now);
    this.identifierRateTracker.set(rateKey, prev);
  }

  public requestRecoveryChallenge(params: {
    identifier: string;
    channel: RecoveryChannel;
    ipAddress?: string;
    resendChallengeId?: string;
  }): {
    accepted: true;
    channel: RecoveryChannel;
    challengeId: string;
    expiresInSeconds: number;
    message: string;
  } {
    const channel: RecoveryChannel = params.channel === 'whatsapp' ? 'whatsapp' : 'email';
    const cleanId = String(params.identifier || '').trim().toLowerCase();
    const ttlSeconds = getRecoveryOtpTtlSeconds();
    const genericMessage =
      'If an eligible account with a verified recovery contact exists, a 6-digit verification code has been dispatched.';

    if (!cleanId) {
      throw new HttpError(400, 'Please enter your username, user ID, or registered email.');
    }

    const rateKey = `${cleanId}:${channel}`;
    this.enforceRecoveryRateLimit(rateKey);

    const dummyChallengeId = `RCV-${crypto.randomBytes(8).toString('hex')}`;
    const user = this.academicService.getUserByIdentifier(cleanId);

    if (!user || user.active === false) {
      this.recordSecurityEvent({
        userId: null,
        eventType: 'RECOVERY_UNKNOWN_IDENTIFIER',
        severity: 'info',
        channel,
        ipAddress: params.ipAddress,
        summary: 'Recovery requested for unrecognized or inactive identifier (generic response returned).',
      });
      return {
        accepted: true,
        channel,
        challengeId: dummyChallengeId,
        expiresInSeconds: ttlSeconds,
        message: genericMessage,
      };
    }

    // Strictly exclude administrator accounts from non-admin self-service recovery
    if (user.role === 'admin') {
      this.recordSecurityEvent({
        userId: user.id,
        eventType: 'ADMIN_SELF_SERVICE_RECOVERY_BLOCKED',
        severity: 'warning',
        channel,
        ipAddress: params.ipAddress,
        summary: 'Self-service non-admin password recovery blocked for administrator account.',
      });
      return {
        accepted: true,
        channel,
        challengeId: dummyChallengeId,
        expiresInSeconds: ttlSeconds,
        message: genericMessage,
      };
    }

    const verifiedDestination = this.getPrimaryVerifiedContact(user, channel);
    if (!verifiedDestination) {
      this.recordSecurityEvent({
        userId: user.id,
        eventType: 'RECOVERY_NO_VERIFIED_CONTACT',
        severity: 'warning',
        channel,
        ipAddress: params.ipAddress,
        summary: `Password recovery skipped because ${channel} contact is not verified.`,
      });
      return {
        accepted: true,
        channel,
        challengeId: dummyChallengeId,
        expiresInSeconds: ttlSeconds,
        message: genericMessage,
      };
    }

    const nowMs = this.nowMs();
    const nowIso = new Date(nowMs).toISOString();
    const expiresAtIso = new Date(nowMs + ttlSeconds * 1000).toISOString();
    const challengeId = `RCV-${crypto.randomBytes(8).toString('hex')}`;
    const otpCode = generateEmailOtp();
    const salt = crypto.randomBytes(16).toString('hex');
    const otpHash = hashOtpCode(otpCode, salt);
    const expiresMinutes = Math.max(1, Math.round(ttlSeconds / 60));

    let resendCount = 0;
    if (params.resendChallengeId) {
      const prevRow = this.db
        .prepare('SELECT resend_count FROM verification_challenges WHERE id = ? AND user_id = ?')
        .get(params.resendChallengeId, user.id) as { resend_count: number } | undefined;
      if (prevRow) resendCount = Number(prevRow.resend_count) + 1;
    }

    this.dbWrapper.transaction(() => {
      // Invalidate any prior outstanding password_recovery challenges for this user
      this.db
        .prepare(
          `UPDATE verification_challenges
           SET invalidated_at = ?
           WHERE user_id = ? AND purpose = 'password_recovery' AND consumed_at IS NULL AND invalidated_at IS NULL`
        )
        .run(nowIso, user.id);

      this.db
        .prepare(
          `INSERT INTO verification_challenges (
            id, user_id, purpose, channel, destination, otp_hash, salt,
            expires_at, attempts_count, max_attempts, resend_count, last_sent_at,
            consumed_at, invalidated_at, metadata_json, created_at
          ) VALUES (?, ?, 'password_recovery', ?, ?, ?, ?, ?, 0, 5, ?, ?, NULL, NULL, ?, ?)`
        )
        .run(
          challengeId,
          user.id,
          channel,
          verifiedDestination,
          otpHash,
          salt,
          expiresAtIso,
          resendCount,
          nowIso,
          JSON.stringify({ maskedDestination: channel === 'email' ? maskEmail(verifiedDestination) : maskPhoneNumber(verifiedDestination) }),
          nowIso
        );

      this.recordSecurityEvent({
        userId: user.id,
        eventType: 'RECOVERY_CHALLENGE_ISSUED',
        severity: 'info',
        channel,
        ipAddress: params.ipAddress,
        summary: `Issued password recovery challenge via registered verified ${channel}.`,
        metadata: { challengeId, channel },
      });
    });

    // Deliver using shared notification templates; NEVER persist plaintext OTP in SQLite logs
    if (channel === 'email') {
      const emailHtml = buildPasswordRecoveryEmailHtml({
        recipientName: user.name,
        purposeTitle: 'Password Recovery Verification',
        otpCode,
        expiresInMinutes: expiresMinutes,
        userIdCode: user.userIdCode,
        supportEmail: this.supportEmail,
      });
      this.academicService.recordEmailLog({
        toEmail: verifiedDestination,
        subject: `Password Recovery Security Code · මං 5හේ`,
        category: 'otp_recovery',
        htmlBody: buildSecurityAlertEmailHtml({
          recipientName: user.name,
          headline: 'Password Recovery Verification Dispatched',
          summary: `A single-use 6-digit verification code was delivered via encrypted email transport (valid ${expiresMinutes} minutes).`,
          actionTimeIso: nowIso,
          supportEmail: this.supportEmail,
        }),
      });
      this.onDispatchOtp?.({
        userId: user.id,
        channel: 'email',
        purpose: 'password_recovery',
        destination: verifiedDestination,
        otpCode,
        expiresAt: expiresAtIso,
        emailSubject: 'Password Recovery Security Code · මං 5හේ',
        emailHtml,
      });
    } else {
      const waPayload = buildWhatsAppRecoveryTemplatePayload({
        otpCode,
        expiresInMinutes: expiresMinutes,
        maskedDestination: maskPhoneNumber(verifiedDestination),
      });
      try {
        this.academicService.recordWhatsAppLog({
          toNumber: verifiedDestination,
          category: 'otp_recovery',
          messageText: waPayload.redactedAuditSummary,
          deliveryStatus: 'delivered',
        });
        this.onDispatchOtp?.({
          userId: user.id,
          channel: 'whatsapp',
          purpose: 'password_recovery',
          destination: verifiedDestination,
          otpCode,
          expiresAt: expiresAtIso,
          whatsappPayload: waPayload,
        });
      } catch (err) {
        this.academicService.recordWhatsAppLog({
          toNumber: verifiedDestination,
          category: 'otp_recovery',
          messageText: `WhatsApp recovery template dispatch failed: ${(err as Error).message}`,
          deliveryStatus: 'failed',
        });
        this.recordSecurityEvent({
          userId: user.id,
          eventType: 'RECOVERY_DELIVERY_FAILED',
          severity: 'warning',
          channel: 'whatsapp',
          ipAddress: params.ipAddress,
          summary: 'WhatsApp recovery dispatch encountered a provider error.',
        });
        throw new HttpError(502, 'Unable to deliver WhatsApp verification message right now. Try email recovery.');
      }
    }

    return {
      accepted: true,
      channel,
      challengeId,
      expiresInSeconds: ttlSeconds,
      message: genericMessage,
    };
  }

  public verifyRecoveryChallenge(params: {
    challengeId: string;
    identifier?: string;
    otpCode: string;
    totpCode?: string;
    backupCode?: string;
    ipAddress?: string;
  }): {
    verified: true;
    resetToken: string;
    requiresTotp: boolean;
    totpVerified: boolean;
    expiresInSeconds: number;
  } {
    const challenge = this.db
      .prepare('SELECT * FROM verification_challenges WHERE id = ? AND purpose = ?')
      .get(String(params.challengeId || ''), 'password_recovery') as
      | Record<string, unknown>
      | undefined;

    if (!challenge) {
      throw new HttpError(400, 'Verification code is invalid or expired.');
    }

    const user = this.academicService.getUserById(String(challenge.user_id));
    if (!user || user.role === 'admin' || user.active === false) {
      throw new HttpError(400, 'Verification code is invalid or expired.');
    }

    if (params.identifier) {
      const matched = this.academicService.getUserByIdentifier(params.identifier);
      if (!matched || matched.id !== user.id) {
        throw new HttpError(400, 'Verification code is invalid or expired.');
      }
    }

    if (challenge.consumed_at || challenge.invalidated_at) {
      throw new HttpError(400, 'This verification code has already been used or invalidated.');
    }

    const nowMs = this.nowMs();
    if (Date.parse(String(challenge.expires_at)) <= nowMs) {
      throw new HttpError(400, 'Verification code has expired. Please request a new code.');
    }

    const attempts = Number(challenge.attempts_count || 0);
    const maxAttempts = Number(challenge.max_attempts || 5);
    if (attempts >= maxAttempts) {
      throw new HttpError(429, 'Too many incorrect verification attempts. Request a new recovery code.');
    }

    const otpValid = verifyOtpHash(
      String(params.otpCode || ''),
      String(challenge.salt),
      String(challenge.otp_hash)
    );

    if (!otpValid) {
      const nextAttempts = attempts + 1;
      const shouldInvalidate = nextAttempts >= maxAttempts;
      this.db
        .prepare(
          'UPDATE verification_challenges SET attempts_count = ?, invalidated_at = COALESCE(invalidated_at, ?) WHERE id = ?'
        )
        .run(nextAttempts, shouldInvalidate ? this.nowIso() : null, String(challenge.id));

      this.recordSecurityEvent({
        userId: user.id,
        eventType: 'RECOVERY_OTP_INVALID',
        severity: shouldInvalidate ? 'warning' : 'info',
        channel: String(challenge.channel),
        ipAddress: params.ipAddress,
        summary: `Invalid recovery OTP attempt (${nextAttempts}/${maxAttempts}).`,
      });
      throw new HttpError(
        shouldInvalidate ? 429 : 400,
        shouldInvalidate
          ? 'Too many incorrect verification attempts. Please request a new recovery code.'
          : 'Incorrect verification code.'
      );
    }

    // Optional immediate second-factor check if TOTP/backup provided during verify step
    let totpVerified = false;
    if (user.totpEnabled) {
      if (params.totpCode) {
        const res = this.verifyTotpForUser(user, params.totpCode, params.ipAddress);
        if (!res.valid) {
          throw new HttpError(400, res.reason || 'Invalid Google Authenticator code.');
        }
        totpVerified = true;
      } else if (params.backupCode) {
        const consumed = this.consumeBackupCode(user.id, params.backupCode, params.ipAddress);
        if (!consumed) {
          throw new HttpError(400, 'Invalid or already used backup recovery code.');
        }
        totpVerified = true;
      }
    } else {
      totpVerified = true;
    }

    const resetToken = crypto.randomBytes(24).toString('hex');
    const resetTokenHash = hashSecretToken(resetToken, this.sessionSecret);
    const resetAuthId = `PRA-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const nowIso = new Date(nowMs).toISOString();
    const resetExpiresIso = new Date(nowMs + 300 * 1000).toISOString();

    this.dbWrapper.transaction(() => {
      this.db
        .prepare('UPDATE verification_challenges SET consumed_at = ? WHERE id = ?')
        .run(nowIso, String(challenge.id));

      this.db
        .prepare(
          `INSERT INTO password_reset_authorizations (
            id, user_id, challenge_id, requires_totp, totp_verified, reset_token_hash, expires_at, used_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`
        )
        .run(
          resetAuthId,
          user.id,
          String(challenge.id),
          user.totpEnabled ? 1 : 0,
          totpVerified ? 1 : 0,
          resetTokenHash,
          resetExpiresIso,
          nowIso
        );

      this.recordSecurityEvent({
        userId: user.id,
        eventType: 'RECOVERY_CHANNEL_VERIFIED',
        severity: 'info',
        channel: String(challenge.channel),
        ipAddress: params.ipAddress,
        summary: `Verified ${String(challenge.channel)} recovery challenge and issued short-lived password reset authorization.`,
      });
    });

    return {
      verified: true,
      resetToken,
      requiresTotp: user.totpEnabled && !totpVerified,
      totpVerified,
      expiresInSeconds: 300,
    };
  }

  private assertPasswordNotReused(user: UserAccount, newPassword: string): void {
    if (verifyPassword(newPassword, user.passwordHash)) {
      throw new HttpError(400, 'New password must differ from your current password.');
    }
    const histRows = this.db
      .prepare('SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 5')
      .all(user.id) as { password_hash: string }[];
    for (const r of histRows) {
      if (verifyPassword(newPassword, r.password_hash)) {
        throw new HttpError(400, 'You cannot reuse one of your recent passwords.');
      }
    }
  }

  public completePasswordReset(params: {
    resetToken: string;
    newPassword: string;
    totpCode?: string;
    backupCode?: string;
    ipAddress?: string;
  }): { ok: true; sessionsRevoked: number } {
    const tokenHash = hashSecretToken(String(params.resetToken || ''), this.sessionSecret);
    const authRow = this.db
      .prepare('SELECT * FROM password_reset_authorizations WHERE reset_token_hash = ?')
      .get(tokenHash) as Record<string, unknown> | undefined;

    if (!authRow) {
      throw new HttpError(400, 'Password reset authorization is invalid.');
    }
    if (authRow.used_at) {
      throw new HttpError(400, 'This password reset authorization has already been used.');
    }
    if (Date.parse(String(authRow.expires_at)) <= this.nowMs()) {
      throw new HttpError(400, 'Password reset authorization has expired. Please restart recovery.');
    }

    const user = this.academicService.getUserById(String(authRow.user_id));
    if (!user || user.role === 'admin' || user.active === false) {
      throw new HttpError(403, 'Account is not eligible for self-service password reset.');
    }

    const requiresTotp = Number(authRow.requires_totp ?? 0) === 1 || user.totpEnabled;
    let totpVerified = Number(authRow.totp_verified ?? 0) === 1;

    if (requiresTotp && !totpVerified) {
      if (params.totpCode) {
        const v = this.verifyTotpForUser(user, params.totpCode, params.ipAddress);
        if (!v.valid) {
          throw new HttpError(400, v.reason || 'Invalid Google Authenticator code.');
        }
        totpVerified = true;
      } else if (params.backupCode) {
        const consumed = this.consumeBackupCode(user.id, params.backupCode, params.ipAddress);
        if (!consumed) {
          throw new HttpError(400, 'Invalid or already used backup recovery code.');
        }
        totpVerified = true;
      } else {
        throw new HttpError(
          403,
          'Google Authenticator or backup recovery code verification is required before resetting your password.'
        );
      }
    }

    const policy = validatePasswordPolicy(params.newPassword, {
      username: user.username,
      email: user.email,
      userIdCode: user.userIdCode,
    });
    if (!policy.ok) {
      throw new HttpError(400, policy.errors[0]);
    }
    this.assertPasswordNotReused(user, params.newPassword);

    const newHash = hashPassword(params.newPassword);
    const nowIso = this.nowIso();
    let sessionsRevoked = 0;

    this.dbWrapper.transaction(() => {
      this.db
        .prepare('UPDATE users SET password_hash = ?, password_updated_at = ? WHERE id = ?')
        .run(newHash, nowIso, user.id);

      this.db
        .prepare('INSERT INTO password_history (id, user_id, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(`PWH-${crypto.randomBytes(5).toString('hex')}`, user.id, newHash, nowIso);

      this.db
        .prepare('UPDATE password_reset_authorizations SET used_at = ?, totp_verified = ? WHERE id = ?')
        .run(nowIso, totpVerified ? 1 : 0, String(authRow.id));

      this.db
        .prepare(
          `UPDATE verification_challenges SET invalidated_at = ?
           WHERE user_id = ? AND purpose = 'password_recovery' AND consumed_at IS NULL AND invalidated_at IS NULL`
        )
        .run(nowIso, user.id);

      sessionsRevoked = this.revokeAllSessions(user.id, 'password_reset');

      this.recordSecurityEvent({
        userId: user.id,
        eventType: 'PASSWORD_RESET_COMPLETED',
        severity: 'warning',
        ipAddress: params.ipAddress,
        summary: `Password reset completed; ${sessionsRevoked} active session(s) revoked.`,
        metadata: { sessionsRevoked },
      });

      this.academicService.writeAuditLog({
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        action: 'PASSWORD_RESET_COMPLETED',
        targetType: 'user',
        targetId: user.id,
        details: { sessionsRevoked },
      });
    });

    this.dispatchSecurityAlert({
      user,
      headline: 'Your Account Password Was Reset',
      summary: `Your මං 5හේ password was changed via verified account recovery and ${sessionsRevoked} active session(s) were signed out.`,
      dedupePrefix: `pwreset-${user.id}`,
    });

    return { ok: true, sessionsRevoked };
  }

  // --- Authenticated Password Change ---
  public changePassword(
    user: UserAccount,
    params: {
      currentPassword: string;
      newPassword: string;
      totpCode?: string;
      revokeOtherSessions?: boolean;
      currentJti?: string;
      ipAddress?: string;
    }
  ): { ok: true; sessionsRevoked: number } {
    if (!verifyPassword(String(params.currentPassword || ''), user.passwordHash)) {
      this.recordSecurityEvent({
        userId: user.id,
        eventType: 'PASSWORD_CHANGE_FAILED_CURRENT',
        severity: 'warning',
        ipAddress: params.ipAddress,
        summary: 'Incorrect current password supplied during password change.',
      });
      throw new HttpError(401, 'Current password is incorrect.');
    }

    if (user.totpEnabled) {
      const check = this.verifyTotpForUser(user, String(params.totpCode || ''), params.ipAddress);
      if (!check.valid) {
        throw new HttpError(400, check.reason || 'Valid Google Authenticator code is required.');
      }
    }

    const policy = validatePasswordPolicy(params.newPassword, {
      username: user.username,
      email: user.email,
      userIdCode: user.userIdCode,
    });
    if (!policy.ok) {
      throw new HttpError(400, policy.errors[0]);
    }
    this.assertPasswordNotReused(user, params.newPassword);

    const newHash = hashPassword(params.newPassword);
    const nowIso = this.nowIso();
    let sessionsRevoked = 0;

    this.dbWrapper.transaction(() => {
      this.db
        .prepare('UPDATE users SET password_hash = ?, password_updated_at = ? WHERE id = ?')
        .run(newHash, nowIso, user.id);

      this.db
        .prepare('INSERT INTO password_history (id, user_id, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(`PWH-${crypto.randomBytes(5).toString('hex')}`, user.id, newHash, nowIso);

      if (params.revokeOtherSessions !== false) {
        sessionsRevoked = this.revokeOtherSessions(user.id, params.currentJti, 'password_changed');
      }

      this.recordSecurityEvent({
        userId: user.id,
        eventType: 'PASSWORD_CHANGED',
        severity: 'info',
        ipAddress: params.ipAddress,
        summary: `Account password updated (${sessionsRevoked} other session(s) revoked).`,
        metadata: { sessionsRevoked },
      });

      this.academicService.writeAuditLog({
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        action: 'PASSWORD_CHANGED',
        targetType: 'user',
        targetId: user.id,
        details: { sessionsRevoked },
      });
    });

    this.dispatchSecurityAlert({
      user,
      headline: 'Account Password Changed',
      summary: 'Your password was successfully changed from Account & Security.',
      dedupePrefix: `pwchg-${user.id}`,
    });

    return { ok: true, sessionsRevoked };
  }

  // --- Username Management ---
  public changeUsername(
    user: UserAccount,
    params: {
      newUsername: string;
      currentPassword?: string;
      totpCode?: string;
      ipAddress?: string;
    }
  ): UserAccount {
    if (user.role === 'admin') {
      throw new HttpError(403, 'Administrator usernames are managed separately from self-service profile controls.');
    }
    if (params.currentPassword !== undefined) {
      if (!verifyPassword(params.currentPassword, user.passwordHash)) {
        throw new HttpError(401, 'Current password confirmation is incorrect.');
      }
    }
    if (user.totpEnabled && params.totpCode) {
      const check = this.verifyTotpForUser(user, params.totpCode, params.ipAddress);
      if (!check.valid) {
        throw new HttpError(400, check.reason || 'Invalid Google Authenticator code.');
      }
    }

    const validation = validateUsername(params.newUsername);
    if (!validation.ok) {
      throw new HttpError(400, validation.error || 'Invalid username.');
    }

    const nextUsername = validation.normalized;
    if (nextUsername === (user.username || '').toLowerCase()) {
      throw new HttpError(400, 'Please enter a different username from your current one.');
    }

    const cooldownHours = getUsernameChangeCooldownHours();
    if (user.usernameUpdatedAt && cooldownHours > 0) {
      const elapsedMs = this.nowMs() - Date.parse(user.usernameUpdatedAt);
      if (elapsedMs < cooldownHours * 3_600_000) {
        throw new HttpError(
          429,
          `Username can only be changed once every ${cooldownHours} hours.`
        );
      }
    }

    const collision = this.db
      .prepare(
        `SELECT id FROM users
         WHERE id != ? AND (LOWER(COALESCE(username, '')) = ? OR LOWER(user_id_code) = ? OR LOWER(email) = ?)`
      )
      .get(user.id, nextUsername, nextUsername, nextUsername);
    if (collision) {
      throw new HttpError(409, 'This username is already taken.');
    }

    const nowIso = this.nowIso();
    const oldUsername = user.username || user.userIdCode.toLowerCase();

    this.dbWrapper.transaction(() => {
      this.db
        .prepare('UPDATE users SET username = ?, username_updated_at = ? WHERE id = ?')
        .run(nextUsername, nowIso, user.id);

      this.db
        .prepare(
          'INSERT INTO username_history (id, user_id, old_username, new_username, changed_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(`UNH-${crypto.randomBytes(5).toString('hex')}`, user.id, oldUsername, nextUsername, user.id, nowIso);

      this.recordSecurityEvent({
        userId: user.id,
        eventType: 'USERNAME_CHANGED',
        severity: 'info',
        ipAddress: params.ipAddress,
        summary: `Username updated from '${oldUsername}' to '${nextUsername}'.`,
        metadata: { oldUsername, newUsername: nextUsername },
      });

      this.academicService.writeAuditLog({
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        action: 'USERNAME_CHANGED',
        targetType: 'user',
        targetId: user.id,
        details: { oldUsername, newUsername: nextUsername },
      });
    });

    const updated = this.academicService.getUserById(user.id)!;
    this.dispatchSecurityAlert({
      user: updated,
      headline: 'Username Updated',
      summary: `Your sign-in username was changed from @${oldUsername} to @${nextUsername}. Your internal account records and study history remain intact.`,
      dedupePrefix: `usrchg-${user.id}`,
    });
    return updated;
  }

  // --- Verified Email & WhatsApp Contact Changes ---
  public requestContactChange(
    user: UserAccount,
    params: {
      channel: RecoveryChannel;
      newContact: string;
      currentPassword: string;
      totpCode?: string;
      lostOldContact?: boolean;
      verificationNotes?: string;
      ipAddress?: string;
    }
  ): {
    escalatedToAdmin: boolean;
    requestId: string;
    channel: RecoveryChannel;
    expiresInSeconds?: number;
    message: string;
  } {
    if (user.role === 'admin') {
      throw new HttpError(403, 'Administrator contacts are managed through the separate protected admin recovery process.');
    }

    if (!verifyPassword(String(params.currentPassword || ''), user.passwordHash)) {
      throw new HttpError(401, 'Current password confirmation is incorrect.');
    }

    if (user.totpEnabled) {
      const check = this.verifyTotpForUser(user, String(params.totpCode || ''), params.ipAddress);
      if (!check.valid) {
        throw new HttpError(400, check.reason || 'Valid Google Authenticator code is required.');
      }
    }

    const channel: RecoveryChannel = params.channel === 'whatsapp' ? 'whatsapp' : 'email';
    let normalizedNew = '';
    if (channel === 'email') {
      const check = normalizeEmail(params.newContact);
      if (!check.ok) throw new HttpError(400, check.error || 'Invalid email address.');
      normalizedNew = check.email;
      if (normalizedNew === user.email.toLowerCase()) {
        throw new HttpError(400, 'New email address matches your current verified email.');
      }
      const dup = this.db
        .prepare('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?')
        .get(normalizedNew, user.id);
      if (dup) {
        throw new HttpError(409, 'This email address is already registered to another account.');
      }
    } else {
      const check = normalizeWhatsAppNumber(params.newContact);
      if (!check.ok) throw new HttpError(400, check.error || 'Invalid WhatsApp number.');
      normalizedNew = check.normalized;
      if (normalizedNew === user.whatsappNumber) {
        throw new HttpError(400, 'New WhatsApp number matches your current number.');
      }
      // Household sharing allowed only between linked parent and child
      const others = this.db
        .prepare('SELECT id, role, guardian_user_id FROM users WHERE whatsapp_number = ? AND id != ?')
        .all(normalizedNew, user.id) as { id: string; role: string; guardian_user_id: string | null }[];
      const unrelated = others.some(
        (o) => o.guardian_user_id !== user.id && user.guardianUserId !== o.id
      );
      if (unrelated) {
        throw new HttpError(409, 'This WhatsApp number is already linked to another account.');
      }
    }

    const oldContact = channel === 'email' ? user.email : user.whatsappNumber;
    const nowMs = this.nowMs();
    const nowIso = new Date(nowMs).toISOString();

    if (params.lostOldContact) {
      const adminReqId = `ARR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      this.dbWrapper.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO admin_recovery_requests (
              id, target_user_id, request_type, requester_identifier, verification_notes,
              status, requested_by_user_id, verification_evidence_json, created_at, updated_at
            ) VALUES (?, ?, 'contact_recovery', ?, ?, 'PENDING_APPROVAL', ?, ?, ?, ?)`
          )
          .run(
            adminReqId,
            user.id,
            user.email,
            String(params.verificationNotes || `Requested recovery change for ${channel} to ${normalizedNew}`),
            user.id,
            JSON.stringify({ channel, oldContact, requestedNewContact: normalizedNew }),
            nowIso,
            nowIso
          );

        this.recordSecurityEvent({
          userId: user.id,
          eventType: 'CONTACT_CHANGE_ESCALATED_ADMIN',
          severity: 'warning',
          channel,
          ipAddress: params.ipAddress,
          summary: `Lost ${channel} access escalated for administrator recovery verification (${adminReqId}).`,
          metadata: { adminReqId, channel },
        });
      });
      return {
        escalatedToAdmin: true,
        requestId: adminReqId,
        channel,
        message: 'Lost-contact recovery request submitted for verified administrator review.',
      };
    }

    const ttlSeconds = getRecoveryOtpTtlSeconds();
    const expiresIso = new Date(nowMs + ttlSeconds * 1000).toISOString();
    const expiresMinutes = Math.max(1, Math.round(ttlSeconds / 60));
    const reqId = `CCR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const challengeId = `CHG-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const otpCode = generateEmailOtp();
    const salt = crypto.randomBytes(16).toString('hex');
    const otpHash = hashOtpCode(otpCode, salt);
    const purpose = channel === 'email' ? 'contact_change_email' : 'contact_change_whatsapp';

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `UPDATE contact_change_requests SET status = 'CANCELLED' WHERE user_id = ? AND channel = ? AND status = 'PENDING'`
        )
        .run(user.id, channel);

      this.db
        .prepare(
          `INSERT INTO verification_challenges (
            id, user_id, purpose, channel, destination, otp_hash, salt,
            expires_at, attempts_count, max_attempts, resend_count, last_sent_at,
            consumed_at, invalidated_at, metadata_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 5, 0, ?, NULL, NULL, ?, ?)`
        )
        .run(
          challengeId,
          user.id,
          purpose,
          channel,
          normalizedNew,
          otpHash,
          salt,
          expiresIso,
          nowIso,
          JSON.stringify({ requestId: reqId }),
          nowIso
        );

      this.db
        .prepare(
          `INSERT INTO contact_change_requests (
            id, user_id, channel, old_contact, new_contact, challenge_id,
            step_up_verified, status, expires_at, completed_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, 'PENDING', ?, NULL, ?)`
        )
        .run(reqId, user.id, channel, oldContact, normalizedNew, challengeId, expiresIso, nowIso);

      this.recordSecurityEvent({
        userId: user.id,
        eventType: 'CONTACT_CHANGE_REQUESTED',
        severity: 'info',
        channel,
        ipAddress: params.ipAddress,
        summary: `Initiated verified ${channel} change request (pending new contact verification).`,
        metadata: { requestId: reqId, channel },
      });
    });

    // Send OTP strictly to NEW contact before updating DB
    if (channel === 'email') {
      const html = buildPasswordRecoveryEmailHtml({
        recipientName: user.name,
        purposeTitle: 'Verify New Email Address',
        otpCode,
        expiresInMinutes: expiresMinutes,
        userIdCode: user.userIdCode,
        supportEmail: this.supportEmail,
      });
      this.academicService.recordEmailLog({
        toEmail: normalizedNew,
        subject: `Verify New Email Address · මං 5හේ`,
        category: 'otp_contact_change',
        htmlBody: buildSecurityAlertEmailHtml({
          recipientName: user.name,
          headline: 'New Email Verification Requested',
          summary: `Verification challenge dispatched to your proposed email address (valid ${expiresMinutes} minutes).`,
          actionTimeIso: nowIso,
          supportEmail: this.supportEmail,
        }),
      });
      this.onDispatchOtp?.({
        userId: user.id,
        channel: 'email',
        purpose,
        destination: normalizedNew,
        otpCode,
        expiresAt: expiresIso,
        emailSubject: 'Verify New Email Address · මං 5හේ',
        emailHtml: html,
      });
    } else {
      const waPayload = buildWhatsAppRecoveryTemplatePayload({
        otpCode,
        expiresInMinutes: expiresMinutes,
        maskedDestination: maskPhoneNumber(normalizedNew),
      });
      this.academicService.recordWhatsAppLog({
        toNumber: normalizedNew,
        category: 'otp_contact_change',
        messageText: waPayload.redactedAuditSummary,
        deliveryStatus: 'delivered',
      });
      this.onDispatchOtp?.({
        userId: user.id,
        channel: 'whatsapp',
        purpose,
        destination: normalizedNew,
        otpCode,
        expiresAt: expiresIso,
        whatsappPayload: waPayload,
      });
    }

    return {
      escalatedToAdmin: false,
      requestId: reqId,
      channel,
      expiresInSeconds: ttlSeconds,
      message: `Enter the 6-digit verification code sent to your new ${channel === 'email' ? 'email address' : 'WhatsApp number'} to complete the update.`,
    };
  }

  public confirmContactChange(
    user: UserAccount,
    params: { requestId: string; otpCode: string; ipAddress?: string }
  ): UserAccount {
    const reqRow = this.db
      .prepare('SELECT * FROM contact_change_requests WHERE id = ? AND user_id = ?')
      .get(String(params.requestId || ''), user.id) as Record<string, unknown> | undefined;

    if (!reqRow || String(reqRow.status) !== 'PENDING') {
      throw new HttpError(404, 'Pending contact change request not found.');
    }
    if (Date.parse(String(reqRow.expires_at)) <= this.nowMs()) {
      this.db
        .prepare("UPDATE contact_change_requests SET status = 'EXPIRED' WHERE id = ?")
        .run(String(reqRow.id));
      throw new HttpError(400, 'Contact verification request has expired. Please start again.');
    }

    const challenge = this.db
      .prepare('SELECT * FROM verification_challenges WHERE id = ?')
      .get(String(reqRow.challenge_id)) as Record<string, unknown> | undefined;
    if (!challenge || challenge.consumed_at || challenge.invalidated_at) {
      throw new HttpError(400, 'Verification challenge is no longer active.');
    }

    const attempts = Number(challenge.attempts_count || 0);
    const maxAttempts = Number(challenge.max_attempts || 5);
    if (attempts >= maxAttempts) {
      throw new HttpError(429, 'Too many failed verification attempts.');
    }

    const ok = verifyOtpHash(
      String(params.otpCode || ''),
      String(challenge.salt),
      String(challenge.otp_hash)
    );
    if (!ok) {
      const nextAttempts = attempts + 1;
      this.db
        .prepare(
          'UPDATE verification_challenges SET attempts_count = ?, invalidated_at = COALESCE(invalidated_at, ?) WHERE id = ?'
        )
        .run(nextAttempts, nextAttempts >= maxAttempts ? this.nowIso() : null, String(challenge.id));
      throw new HttpError(400, 'Incorrect verification code for new contact.');
    }

    const channel = String(reqRow.channel) as RecoveryChannel;
    const oldContact = String(reqRow.old_contact);
    const newContact = String(reqRow.new_contact);
    const nowIso = this.nowIso();

    this.dbWrapper.transaction(() => {
      this.db
        .prepare('UPDATE verification_challenges SET consumed_at = ? WHERE id = ?')
        .run(nowIso, String(challenge.id));

      this.db
        .prepare("UPDATE contact_change_requests SET status = 'VERIFIED', completed_at = ? WHERE id = ?")
        .run(nowIso, String(reqRow.id));

      if (channel === 'email') {
        this.db
          .prepare('UPDATE users SET email = ?, email_verified = 1 WHERE id = ?')
          .run(newContact, user.id);
      } else {
        this.db
          .prepare('UPDATE users SET whatsapp_number = ?, whatsapp_verified = 1 WHERE id = ?')
          .run(newContact, user.id);
      }

      this.db
        .prepare('UPDATE verified_recovery_contacts SET is_primary = 0, updated_at = ? WHERE user_id = ? AND channel = ?')
        .run(nowIso, user.id, channel);

      this.db
        .prepare(
          `INSERT INTO verified_recovery_contacts (
            id, user_id, channel, contact_value, is_primary, verified, verified_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?)
          ON CONFLICT(user_id, channel, contact_value) DO UPDATE SET
            is_primary = 1, verified = 1, verified_at = excluded.verified_at, updated_at = excluded.updated_at`
        )
        .run(`VRC-${crypto.randomBytes(4).toString('hex')}`, user.id, channel, newContact, nowIso, nowIso, nowIso);

      this.recordSecurityEvent({
        userId: user.id,
        eventType: channel === 'email' ? 'EMAIL_CHANGED' : 'WHATSAPP_CHANGED',
        severity: 'warning',
        channel,
        ipAddress: params.ipAddress,
        summary: `Verified primary ${channel} contact changed from ${channel === 'email' ? maskEmail(oldContact) : maskPhoneNumber(oldContact)} to ${channel === 'email' ? maskEmail(newContact) : maskPhoneNumber(newContact)}.`,
      });

      this.academicService.writeAuditLog({
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        action: channel === 'email' ? 'USER_EMAIL_CHANGED' : 'USER_WHATSAPP_CHANGED',
        targetType: 'user',
        targetId: user.id,
        details: { channel, requestId: String(reqRow.id) },
      });
    });

    const updated = this.academicService.getUserById(user.id)!;

    // Notify previous verified contact AND new verified contact
    this.dispatchSecurityAlert({
      user: updated,
      headline: `Your Verified ${channel === 'email' ? 'Email' : 'WhatsApp Number'} Was Changed`,
      summary: `Your verified ${channel} recovery contact was updated to ${channel === 'email' ? maskEmail(newContact) : maskPhoneNumber(newContact)}.`,
      overrideEmail: channel === 'email' ? oldContact : undefined,
      overrideWhatsapp: channel === 'whatsapp' ? oldContact : undefined,
      dedupePrefix: `cntold-${reqRow.id}`,
    });

    return updated;
  }

  // --- Google Authenticator (TOTP) Enrollment, Verification, Replay Prevention & Backup Codes ---
  private getTotpEnrollmentRow(userId: string): Record<string, unknown> | undefined {
    return this.db.prepare('SELECT * FROM totp_enrollments WHERE user_id = ?').get(userId) as
      | Record<string, unknown>
      | undefined;
  }

  private assertCanAssistStudentTotp(actor: UserAccount, targetUser: UserAccount): boolean {
    if (actor.id === targetUser.id) {
      if (actor.role === 'admin') {
        throw new HttpError(
          403,
          'Administrator accounts use separate protected authentication and cannot use non-admin TOTP self-enrollment.'
        );
      }
      return false;
    }
    if (actor.role === 'parent' && targetUser.role === 'student' && targetUser.guardianUserId === actor.id) {
      return true;
    }
    throw new HttpError(403, 'Not authorized to manage Google Authenticator for this account.');
  }

  public async startTotpEnrollment(
    actor: UserAccount,
    params: {
      targetStudentId?: string;
      currentPassword?: string;
      currentTotpCode?: string;
      ipAddress?: string;
    } = {}
  ): Promise<{
    targetUserId: string;
    targetUserName: string;
    manualKey: string;
    otpAuthUri: string;
    qrDataUrl: string;
    guardianAssisted: boolean;
    status: 'PENDING_SETUP';
  }> {
    const target = params.targetStudentId
      ? this.academicService.getUserById(params.targetStudentId)
      : actor;
    if (!target) {
      throw new HttpError(404, 'Target account not found.');
    }

    const guardianAssisted = this.assertCanAssistStudentTotp(actor, target);

    // Rotating an already-active TOTP requires recent step-up verification
    if (target.totpEnabled && !guardianAssisted) {
      if (!params.currentPassword || !verifyPassword(params.currentPassword, actor.passwordHash)) {
        throw new HttpError(401, 'Current password is required to replace an active authenticator.');
      }
      const check = this.verifyTotpForUser(target, String(params.currentTotpCode || ''), params.ipAddress);
      if (!check.valid) {
        throw new HttpError(400, check.reason || 'Current 6-digit authenticator code is required to rotate device.');
      }
    } else if (guardianAssisted) {
      if (params.currentPassword && !verifyPassword(params.currentPassword, actor.passwordHash)) {
        throw new HttpError(401, 'Guardian password verification failed.');
      }
    }

    const plaintextSecret = generateTotpSecret(20);
    const encryptedSecret = encryptTotpSecret(plaintextSecret, getTotpEncryptionMasterKey());
    const nowIso = this.nowIso();

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO totp_enrollments (
            id, user_id, encrypted_secret, algorithm, digits, period_seconds, status,
            guardian_assisted, enrolled_by_user_id, last_accepted_step, failed_attempts,
            locked_until, verified_at, disabled_at, created_at, updated_at
          ) VALUES (?, ?, ?, 'SHA1', 6, 30, 'PENDING_SETUP', ?, ?, NULL, 0, NULL, NULL, NULL, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            encrypted_secret = excluded.encrypted_secret,
            status = 'PENDING_SETUP',
            guardian_assisted = excluded.guardian_assisted,
            enrolled_by_user_id = excluded.enrolled_by_user_id,
            failed_attempts = 0,
            locked_until = NULL,
            updated_at = excluded.updated_at`
        )
        .run(
          `TOTP-${target.id}`,
          target.id,
          encryptedSecret,
          guardianAssisted ? 1 : 0,
          actor.id,
          nowIso,
          nowIso
        );

      this.recordSecurityEvent({
        userId: target.id,
        actorId: actor.id,
        eventType: 'TOTP_SETUP_STARTED',
        severity: 'info',
        ipAddress: params.ipAddress,
        summary: guardianAssisted
          ? `Guardian ${actor.name} initiated Google Authenticator setup for ${target.name}.`
          : 'Google Authenticator enrollment initialized (pending 6-digit confirmation).',
        metadata: { guardianAssisted },
      });
    });

    const otpAuthUri = buildOtpAuthUri(target.email, plaintextSecret, 'මං 5හේ Scholarship');
    const qrDataUrl = await QRCode.toDataURL(otpAuthUri, { width: 200, margin: 1 });

    return {
      targetUserId: target.id,
      targetUserName: target.name,
      manualKey: plaintextSecret,
      otpAuthUri,
      qrDataUrl,
      guardianAssisted,
      status: 'PENDING_SETUP',
    };
  }

  public confirmTotpEnrollment(
    actor: UserAccount,
    params: {
      code: string;
      targetStudentId?: string;
      ipAddress?: string;
    }
  ): {
    enabled: true;
    targetUserId: string;
    guardianAssisted: boolean;
    backupCodes: string[];
  } {
    const target = params.targetStudentId
      ? this.academicService.getUserById(params.targetStudentId)
      : actor;
    if (!target) throw new HttpError(404, 'Target account not found.');

    const guardianAssisted = this.assertCanAssistStudentTotp(actor, target);
    const enrollment = this.getTotpEnrollmentRow(target.id);
    if (!enrollment) {
      throw new HttpError(400, 'Start Google Authenticator setup first to generate your setup key.');
    }

    const masterKey = getTotpEncryptionMasterKey();
    const plaintextSecret = decryptTotpSecret(String(enrollment.encrypted_secret), masterKey);
    const check = verifyTotpCodeWithStep(plaintextSecret, String(params.code || ''), this.nowMs(), 1);
    if (!check.valid) {
      throw new HttpError(
        400,
        'The 6-digit Google Authenticator code did not match. Verify device time sync and try again.'
      );
    }

    const backupCodes = generateBackupCodes(8);
    const batchId = `BKP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const nowIso = this.nowIso();

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `UPDATE totp_enrollments
           SET status = 'ACTIVE', verified_at = ?, last_accepted_step = ?, failed_attempts = 0,
               locked_until = NULL, disabled_at = NULL, guardian_assisted = ?, enrolled_by_user_id = ?, updated_at = ?
           WHERE user_id = ?`
        )
        .run(nowIso, check.matchedStep, guardianAssisted ? 1 : 0, actor.id, nowIso, target.id);

      this.db
        .prepare(
          `UPDATE users
           SET totp_secret = ?, totp_enabled = 1, totp_enrolled_at = ?, totp_last_accepted_step = ?,
               totp_failed_attempts = 0, totp_locked_until = NULL
           WHERE id = ?`
        )
        .run(String(enrollment.encrypted_secret), nowIso, check.matchedStep, target.id);

      this.db.prepare('DELETE FROM totp_backup_codes WHERE user_id = ?').run(target.id);
      const insertBackup = this.db.prepare(
        `INSERT INTO totp_backup_codes (id, user_id, code_hash, code_hint, batch_id, used_at, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`
      );
      for (const code of backupCodes) {
        insertBackup.run(
          `BC-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
          target.id,
          hashSecretToken(code, masterKey),
          `${code.slice(0, 6)}••••${code.slice(-2)}`,
          batchId,
          nowIso
        );
      }

      this.recordSecurityEvent({
        userId: target.id,
        actorId: actor.id,
        eventType: 'TOTP_ENABLED',
        severity: 'info',
        ipAddress: params.ipAddress,
        summary: guardianAssisted
          ? `Guardian ${actor.name} verified and activated Google Authenticator for ${target.name}.`
          : 'Google Authenticator 2FA activated and 8 backup recovery codes generated.',
        metadata: { guardianAssisted, batchId },
      });

      this.academicService.writeAuditLog({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'TOTP_ENROLLMENT_CONFIRMED',
        targetType: 'user',
        targetId: target.id,
        details: { guardianAssisted },
      });
    });

    const refreshed = this.academicService.getUserById(target.id)!;
    this.dispatchSecurityAlert({
      user: refreshed,
      headline: 'Google Authenticator Enabled',
      summary: guardianAssisted
        ? `Two-factor authentication via Google Authenticator is now active on ${refreshed.name}'s account (guardian-assisted by ${actor.name}).`
        : 'Two-factor authentication via Google Authenticator is now active on your account.',
      dedupePrefix: `totpon-${target.id}`,
    });

    return {
      enabled: true,
      targetUserId: target.id,
      guardianAssisted,
      backupCodes,
    };
  }

  public verifyTotpForUser(
    user: UserAccount,
    code: string,
    ipAddress?: string,
    timestampMs = this.nowMs()
  ): { valid: boolean; matchedStep: number | null; reason?: string } {
    const row = this.db
      .prepare('SELECT totp_secret, totp_last_accepted_step, totp_failed_attempts, totp_locked_until FROM users WHERE id = ?')
      .get(user.id) as
      | {
          totp_secret: string;
          totp_last_accepted_step: number | null;
          totp_failed_attempts: number;
          totp_locked_until: string | null;
        }
      | undefined;
    if (!row) return { valid: false, matchedStep: null, reason: 'Account not found.' };

    if (row.totp_locked_until && Date.parse(row.totp_locked_until) > this.nowMs()) {
      return {
        valid: false,
        matchedStep: null,
        reason: 'Authenticator verification is temporarily locked due to repeated invalid codes.',
      };
    }

    const masterKey = getTotpEncryptionMasterKey();
    const plaintextSecret = decryptTotpSecret(row.totp_secret, masterKey);
    const check = verifyTotpCodeWithStep(plaintextSecret, String(code || ''), timestampMs, 1);

    if (!check.valid || check.matchedStep === null) {
      const nextFails = Number(row.totp_failed_attempts || 0) + 1;
      const lockUntil =
        nextFails >= 5 ? new Date(this.nowMs() + 15 * 60 * 1000).toISOString() : null;
      this.db
        .prepare('UPDATE users SET totp_failed_attempts = ?, totp_locked_until = ? WHERE id = ?')
        .run(nextFails, lockUntil, user.id);
      this.db
        .prepare('UPDATE totp_enrollments SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE user_id = ?')
        .run(nextFails, lockUntil, this.nowIso(), user.id);

      this.recordSecurityEvent({
        userId: user.id,
        eventType: lockUntil ? 'TOTP_TEMP_LOCKED' : 'TOTP_VERIFICATION_FAILED',
        severity: lockUntil ? 'warning' : 'info',
        ipAddress,
        summary: lockUntil
          ? 'Google Authenticator locked for 15 minutes after 5 failed attempts.'
          : `Incorrect 6-digit authenticator code (${nextFails}/5).`,
      });
      return {
        valid: false,
        matchedStep: null,
        reason: lockUntil
          ? 'Too many incorrect authenticator codes. Verification locked for 15 minutes.'
          : 'Incorrect Google Authenticator 6-digit code.',
      };
    }

    // Time-step replay prevention
    if (
      row.totp_last_accepted_step !== null &&
      check.matchedStep <= Number(row.totp_last_accepted_step)
    ) {
      this.recordSecurityEvent({
        userId: user.id,
        eventType: 'TOTP_REPLAY_BLOCKED',
        severity: 'warning',
        ipAddress,
        summary: 'Blocked reuse of an already accepted 30-second Google Authenticator code.',
      });
      return {
        valid: false,
        matchedStep: null,
        reason: 'This 6-digit code was already used. Wait for the next 30-second code.',
      };
    }

    this.db
      .prepare('UPDATE users SET totp_last_accepted_step = ?, totp_failed_attempts = 0, totp_locked_until = NULL WHERE id = ?')
      .run(check.matchedStep, user.id);
    this.db
      .prepare('UPDATE totp_enrollments SET last_accepted_step = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE user_id = ?')
      .run(check.matchedStep, this.nowIso(), user.id);

    return { valid: true, matchedStep: check.matchedStep };
  }

  public consumeBackupCode(userId: string, rawCode: string, ipAddress?: string): boolean {
    const clean = String(rawCode || '').trim().toUpperCase();
    if (!clean) return false;
    const masterKey = getTotpEncryptionMasterKey();
    const candidates = this.db
      .prepare('SELECT id, code_hash FROM totp_backup_codes WHERE user_id = ? AND used_at IS NULL')
      .all(userId) as { id: string; code_hash: string }[];

    for (const c of candidates) {
      if (verifySecretTokenHash(clean, c.code_hash, masterKey)) {
        const nowIso = this.nowIso();
        const upd = this.db
          .prepare('UPDATE totp_backup_codes SET used_at = ? WHERE id = ? AND used_at IS NULL')
          .run(nowIso, c.id);
        if (Number(upd.changes) === 1) {
          this.recordSecurityEvent({
            userId,
            eventType: 'BACKUP_CODE_CONSUMED',
            severity: 'warning',
            ipAddress,
            summary: 'Single-use backup recovery code verified and consumed.',
          });
          return true;
        }
      }
    }
    return false;
  }

  public regenerateBackupCodes(
    user: UserAccount,
    params: { currentPassword: string; totpCode: string; ipAddress?: string }
  ): { backupCodes: string[] } {
    if (user.role === 'admin') {
      throw new HttpError(403, 'Administrator accounts use separate recovery controls.');
    }
    if (!user.totpEnabled) {
      throw new HttpError(400, 'Enable Google Authenticator before generating backup recovery codes.');
    }
    if (!verifyPassword(String(params.currentPassword || ''), user.passwordHash)) {
      throw new HttpError(401, 'Current password is incorrect.');
    }
    const totpCheck = this.verifyTotpForUser(user, params.totpCode, params.ipAddress);
    if (!totpCheck.valid) {
      throw new HttpError(400, totpCheck.reason || 'Valid Google Authenticator code is required.');
    }

    const masterKey = getTotpEncryptionMasterKey();
    const codes = generateBackupCodes(8);
    const batchId = `BKP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const nowIso = this.nowIso();

    this.dbWrapper.transaction(() => {
      this.db.prepare('DELETE FROM totp_backup_codes WHERE user_id = ?').run(user.id);
      const stmt = this.db.prepare(
        `INSERT INTO totp_backup_codes (id, user_id, code_hash, code_hint, batch_id, used_at, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`
      );
      for (const code of codes) {
        stmt.run(
          `BC-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
          user.id,
          hashSecretToken(code, masterKey),
          `${code.slice(0, 6)}••••${code.slice(-2)}`,
          batchId,
          nowIso
        );
      }

      this.recordSecurityEvent({
        userId: user.id,
        eventType: 'BACKUP_CODES_REGENERATED',
        severity: 'info',
        ipAddress: params.ipAddress,
        summary: 'Regenerated 8 fresh single-use Google Authenticator backup codes.',
      });
    });

    this.dispatchSecurityAlert({
      user,
      headline: 'Backup Recovery Codes Regenerated',
      summary: 'Your previous unused backup recovery codes were invalidated and 8 new single-use codes were generated.',
      dedupePrefix: `bkpreg-${user.id}`,
    });

    return { backupCodes: codes };
  }

  public async recoverAuthenticator(params: {
    identifier: string;
    password: string;
    mode: 'backup_code' | 'admin_request';
    backupCode?: string;
    reason?: string;
    ipAddress?: string;
  }): Promise<{
    mode: 'backup_code' | 'admin_request';
    recovered?: boolean;
    setup?: Awaited<ReturnType<IdentitySecurityService['startTotpEnrollment']>>;
    requestId?: string;
    message: string;
  }> {
    const user = this.academicService.getUserByIdentifier(String(params.identifier || ''));
    if (!user || user.active === false || !verifyPassword(String(params.password || ''), user.passwordHash)) {
      throw new HttpError(401, 'Invalid account identifier or password.');
    }
    if (user.role === 'admin') {
      this.recordSecurityEvent({
        userId: user.id,
        eventType: 'ADMIN_SELF_SERVICE_TOTP_RECOVERY_BLOCKED',
        severity: 'warning',
        ipAddress: params.ipAddress,
        summary: 'Blocked non-admin authenticator recovery attempt on administrator account.',
      });
      throw new HttpError(403, 'Administrator accounts must use the dedicated protected admin recovery workflow.');
    }

    if (params.mode === 'backup_code') {
      const ok = this.consumeBackupCode(user.id, String(params.backupCode || ''), params.ipAddress);
      if (!ok) {
        throw new HttpError(400, 'Invalid or already consumed backup recovery code.');
      }

      let sessionsRevoked = 0;
      const nowIso = this.nowIso();
      this.dbWrapper.transaction(() => {
        this.db
          .prepare('UPDATE users SET totp_enabled = 0, totp_last_accepted_step = NULL WHERE id = ?')
          .run(user.id);
        this.db
          .prepare("UPDATE totp_enrollments SET status = 'DISABLED', disabled_at = ?, updated_at = ? WHERE user_id = ?")
          .run(nowIso, nowIso, user.id);
        sessionsRevoked = this.revokeAllSessions(user.id, 'authenticator_recovery_reset');
        this.recordSecurityEvent({
          userId: user.id,
          eventType: 'TOTP_RESET_BY_BACKUP_CODE',
          severity: 'warning',
          ipAddress: params.ipAddress,
          summary: `Authenticator reset using single-use backup code; ${sessionsRevoked} active session(s) revoked.`,
          metadata: { sessionsRevoked },
        });
      });

      const refreshedUser = this.academicService.getUserById(user.id)!;
      const setup = await this.startTotpEnrollment(refreshedUser, { ipAddress: params.ipAddress });

      this.dispatchSecurityAlert({
        user: refreshedUser,
        headline: 'Google Authenticator Reset via Backup Code',
        summary: `A backup recovery code was used to reset your authenticator and revoke ${sessionsRevoked} session(s). Scan the new QR code to re-enroll.`,
        dedupePrefix: `totpbkp-${user.id}`,
      });

      return {
        mode: 'backup_code',
        recovered: true,
        setup,
        message: 'Backup recovery code verified. Scan the new QR code in Google Authenticator and confirm with a 6-digit code.',
      };
    }

    // Mode: Escalate to Administrator Recovery Queue
    const reqId = `ARR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const nowIso = this.nowIso();
    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO admin_recovery_requests (
            id, target_user_id, request_type, requester_identifier, verification_notes,
            status, requested_by_user_id, created_at, updated_at
          ) VALUES (?, ?, 'authenticator_reset', ?, ?, 'PENDING_APPROVAL', ?, ?, ?)`
        )
        .run(
          reqId,
          user.id,
          user.email,
          String(params.reason || 'Lost Google Authenticator device without backup codes.'),
          user.id,
          nowIso,
          nowIso
        );
      this.recordSecurityEvent({
        userId: user.id,
        eventType: 'TOTP_ADMIN_RECOVERY_REQUESTED',
        severity: 'warning',
        ipAddress: params.ipAddress,
        summary: `Submitted administrator-assisted authenticator recovery request (${reqId}).`,
      });
    });

    return {
      mode: 'admin_request',
      recovered: false,
      requestId: reqId,
      message: `Recovery request ${reqId} logged for administrator verification.`,
    };
  }

  public async guardianRecoverChildTotp(
    parentUser: UserAccount,
    params: {
      studentId: string;
      parentPassword: string;
      parentTotpCode?: string;
      ipAddress?: string;
    }
  ) {
    if (parentUser.role !== 'parent') {
      throw new HttpError(403, 'Guardian account required for guardian-assisted child recovery.');
    }
    if (!verifyPassword(String(params.parentPassword || ''), parentUser.passwordHash)) {
      throw new HttpError(401, 'Guardian password is incorrect.');
    }
    if (parentUser.totpEnabled) {
      const check = this.verifyTotpForUser(parentUser, String(params.parentTotpCode || ''), params.ipAddress);
      if (!check.valid) {
        throw new HttpError(400, check.reason || 'Valid guardian authenticator code is required.');
      }
    }

    const child = this.academicService.getUserById(params.studentId);
    if (!child || child.role !== 'student' || child.guardianUserId !== parentUser.id) {
      throw new HttpError(403, 'You are not linked as the verified guardian for this student account.');
    }

    const nowIso = this.nowIso();
    let sessionsRevoked = 0;
    this.dbWrapper.transaction(() => {
      this.db
        .prepare('UPDATE users SET totp_enabled = 0, totp_last_accepted_step = NULL WHERE id = ?')
        .run(child.id);
      this.db
        .prepare("UPDATE totp_enrollments SET status = 'DISABLED', disabled_at = ?, updated_at = ? WHERE user_id = ?")
        .run(nowIso, nowIso, child.id);
      sessionsRevoked = this.revokeAllSessions(child.id, 'guardian_totp_recovery');

      this.recordSecurityEvent({
        userId: child.id,
        actorId: parentUser.id,
        eventType: 'GUARDIAN_ASSISTED_TOTP_RECOVERY',
        severity: 'warning',
        ipAddress: params.ipAddress,
        summary: `Guardian ${parentUser.name} reset child authenticator (${sessionsRevoked} session(s) revoked).`,
      });
    });

    const refreshedChild = this.academicService.getUserById(child.id)!;
    const setup = await this.startTotpEnrollment(parentUser, {
      targetStudentId: refreshedChild.id,
      ipAddress: params.ipAddress,
    });

    this.dispatchSecurityAlert({
      user: refreshedChild,
      headline: 'Guardian-Assisted Authenticator Reset',
      summary: `Your guardian ${parentUser.name} initiated an authenticator device reset for your student account.`,
      dedupePrefix: `grdrst-${child.id}`,
    });

    return { setup, sessionsRevoked };
  }

  // --- Separate Protected Administrator Account Recovery ---
  public completeProtectedAdminRecovery(params: {
    identifier: string;
    adminRecoveryKey: string;
    newPassword: string;
    verificationNote?: string;
    ipAddress?: string;
  }): { ok: true; adminUserId: string; sessionsRevoked: number } {
    const configuredKey = process.env.ADMIN_RECOVERY_KEY || '';
    if (!configuredKey || configuredKey.length < 12) {
      throw new HttpError(503, 'Protected administrator recovery key is not configured on the server.');
    }

    const providedBuf = Buffer.from(String(params.adminRecoveryKey || ''), 'utf8');
    const configuredBuf = Buffer.from(configuredKey, 'utf8');
    if (providedBuf.length !== configuredBuf.length || !crypto.timingSafeEqual(providedBuf, configuredBuf)) {
      this.recordSecurityEvent({
        userId: null,
        eventType: 'ADMIN_PROTECTED_RECOVERY_INVALID_KEY',
        severity: 'critical',
        ipAddress: params.ipAddress,
        summary: 'Failed protected administrator recovery attempt (invalid admin recovery key).',
      });
      throw new HttpError(403, 'Protected administrator recovery authorization failed.');
    }

    const admin = this.academicService.getUserByIdentifier(String(params.identifier || ''));
    if (!admin || admin.role !== 'admin') {
      throw new HttpError(404, 'Administrator account not found.');
    }

    const policy = validatePasswordPolicy(params.newPassword, {
      username: admin.username,
      email: admin.email,
      userIdCode: admin.userIdCode,
    });
    if (!policy.ok) {
      throw new HttpError(400, policy.errors[0]);
    }
    this.assertPasswordNotReused(admin, params.newPassword);

    const nowIso = this.nowIso();
    const newHash = hashPassword(params.newPassword);
    let sessionsRevoked = 0;
    const reqId = `ARR-ADM-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    this.dbWrapper.transaction(() => {
      this.db
        .prepare('UPDATE users SET password_hash = ?, password_updated_at = ? WHERE id = ?')
        .run(newHash, nowIso, admin.id);
      this.db
        .prepare('INSERT INTO password_history (id, user_id, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(`PWH-${crypto.randomBytes(5).toString('hex')}`, admin.id, newHash, nowIso);

      this.db
        .prepare(
          `INSERT INTO admin_recovery_requests (
            id, target_user_id, request_type, requester_identifier, verification_notes,
            status, requested_by_user_id, reviewed_by_admin_id, completed_at, created_at, updated_at
          ) VALUES (?, ?, 'admin_account_recovery', ?, ?, 'COMPLETED', ?, ?, ?, ?, ?)`
        )
        .run(
          reqId,
          admin.id,
          admin.email,
          String(params.verificationNote || 'Verified protected admin recovery key execution'),
          admin.id,
          admin.id,
          nowIso,
          nowIso,
          nowIso
        );

      sessionsRevoked = this.revokeAllSessions(admin.id, 'protected_admin_recovery');

      this.recordSecurityEvent({
        userId: admin.id,
        eventType: 'ADMIN_PROTECTED_RECOVERY_COMPLETED',
        severity: 'critical',
        ipAddress: params.ipAddress,
        summary: `Protected administrator recovery completed; ${sessionsRevoked} session(s) revoked.`,
        metadata: { reqId, sessionsRevoked },
      });

      this.academicService.writeAuditLog({
        actorId: admin.id,
        actorName: admin.name,
        actorRole: 'admin',
        action: 'ADMIN_PROTECTED_RECOVERY_COMPLETED',
        targetType: 'user',
        targetId: admin.id,
        details: { reqId, sessionsRevoked },
      });
    });

    this.dispatchSecurityAlert({
      user: admin,
      headline: 'Administrator Credential Recovery Completed',
      summary: `Protected administrator recovery was completed and ${sessionsRevoked} active session(s) were revoked.`,
      dedupePrefix: `admrcv-${admin.id}`,
    });

    return { ok: true, adminUserId: admin.id, sessionsRevoked };
  }

  // --- Auditable Admin Recovery Queue (Oversight of User Lost-Authenticator / Lost-Contact Requests) ---
  public listAdminRecoveryRequests(adminUser: UserAccount): AdminRecoveryRequestRecord[] {
    if (adminUser.role !== 'admin') {
      throw new HttpError(403, 'Administrator access required.');
    }
    const rows = this.db
      .prepare(
        `SELECT r.*, u.name as target_name, u.email as target_email, u.role as target_role
         FROM admin_recovery_requests r
         JOIN users u ON u.id = r.target_user_id
         ORDER BY CASE WHEN r.status = 'PENDING_APPROVAL' THEN 0 ELSE 1 END, r.created_at DESC
         LIMIT 50`
      )
      .all() as Record<string, unknown>[];

    return rows.map((r) => ({
      id: String(r.id),
      targetUserId: String(r.target_user_id),
      targetUserName: String(r.target_name),
      targetUserEmail: String(r.target_email),
      targetUserRole: String(r.target_role) as UserRole,
      requestType: String(r.request_type) as AdminRecoveryRequestRecord['requestType'],
      requesterIdentifier: String(r.requester_identifier),
      verificationNotes: String(r.verification_notes),
      status: String(r.status) as AdminRecoveryRequestRecord['status'],
      requestedByUserId: r.requested_by_user_id ? String(r.requested_by_user_id) : null,
      reviewedByAdminId: r.reviewed_by_admin_id ? String(r.reviewed_by_admin_id) : null,
      cooldownUntil: r.cooldown_until ? String(r.cooldown_until) : null,
      completedAt: r.completed_at ? String(r.completed_at) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
  }

  public reviewAdminRecoveryRequest(
    adminUser: UserAccount,
    requestId: string,
    payload: {
      decision: 'APPROVE' | 'REJECT';
      notes: string;
      newContactOverride?: string;
    }
  ): AdminRecoveryRequestRecord {
    if (adminUser.role !== 'admin') {
      throw new HttpError(403, 'Administrator role required.');
    }
    const reqRow = this.db
      .prepare('SELECT * FROM admin_recovery_requests WHERE id = ?')
      .get(requestId) as Record<string, unknown> | undefined;
    if (!reqRow) {
      throw new HttpError(404, 'Recovery request not found.');
    }
    if (String(reqRow.status) !== 'PENDING_APPROVAL') {
      throw new HttpError(400, 'Recovery request has already been reviewed.');
    }
    if (!String(payload.notes || '').trim()) {
      throw new HttpError(400, 'Verification review notes are required for audit traceability.');
    }

    const targetUser = this.academicService.getUserById(String(reqRow.target_user_id));
    if (!targetUser) throw new HttpError(404, 'Target account not found.');

    const nowIso = this.nowIso();
    const requestType = String(reqRow.request_type);

    if (payload.decision === 'REJECT') {
      this.dbWrapper.transaction(() => {
        this.db
          .prepare(
            "UPDATE admin_recovery_requests SET status = 'REJECTED', reviewed_by_admin_id = ?, verification_notes = ?, updated_at = ? WHERE id = ?"
          )
          .run(adminUser.id, payload.notes.trim(), nowIso, requestId);

        this.recordSecurityEvent({
          userId: targetUser.id,
          actorId: adminUser.id,
          eventType: 'ADMIN_RECOVERY_REJECTED',
          severity: 'warning',
          summary: `Administrator rejected ${requestType} request ${requestId}.`,
        });

        this.academicService.writeAuditLog({
          actorId: adminUser.id,
          actorName: adminUser.name,
          actorRole: 'admin',
          action: 'ADMIN_RECOVERY_REQUEST_REJECTED',
          targetType: 'admin_recovery_requests',
          targetId: requestId,
          details: { targetUserId: targetUser.id, notes: payload.notes.trim() },
        });
      });
    } else {
      const evidence = (() => {
        try {
          return JSON.parse(String(reqRow.verification_evidence_json || '{}')) as {
            channel?: RecoveryChannel;
            requestedNewContact?: string;
          };
        } catch {
          return {};
        }
      })();

      this.dbWrapper.transaction(() => {
        if (requestType === 'authenticator_reset') {
          this.db
            .prepare('UPDATE users SET totp_enabled = 0, totp_last_accepted_step = NULL, totp_locked_until = NULL, totp_failed_attempts = 0 WHERE id = ?')
            .run(targetUser.id);
          this.db
            .prepare("UPDATE totp_enrollments SET status = 'DISABLED', disabled_at = ?, updated_at = ? WHERE user_id = ?")
            .run(nowIso, nowIso, targetUser.id);
          this.revokeAllSessions(targetUser.id, 'admin_approved_authenticator_reset');
        } else if (requestType === 'contact_recovery') {
          const ch = evidence.channel === 'whatsapp' ? 'whatsapp' : 'email';
          const nextContact = String(payload.newContactOverride || evidence.requestedNewContact || '').trim();
          if (!nextContact) {
            throw new HttpError(400, 'Replacement verified contact value is required.');
          }
          if (ch === 'email') {
            this.db
              .prepare('UPDATE users SET email = ?, email_verified = 1 WHERE id = ?')
              .run(nextContact.toLowerCase(), targetUser.id);
          } else {
            this.db
              .prepare('UPDATE users SET whatsapp_number = ?, whatsapp_verified = 1 WHERE id = ?')
              .run(nextContact, targetUser.id);
          }
          this.db
            .prepare('UPDATE verified_recovery_contacts SET is_primary = 0, updated_at = ? WHERE user_id = ? AND channel = ?')
            .run(nowIso, targetUser.id, ch);
          this.db
            .prepare(
              `INSERT INTO verified_recovery_contacts (id, user_id, channel, contact_value, is_primary, verified, verified_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?)
               ON CONFLICT(user_id, channel, contact_value) DO UPDATE SET is_primary = 1, verified = 1, verified_at = excluded.verified_at, updated_at = excluded.updated_at`
            )
            .run(`VRC-${crypto.randomBytes(4).toString('hex')}`, targetUser.id, ch, ch === 'email' ? nextContact.toLowerCase() : nextContact, nowIso, nowIso, nowIso);
        } else if (requestType === 'unlock') {
          this.db
            .prepare('UPDATE users SET totp_failed_attempts = 0, totp_locked_until = NULL WHERE id = ?')
            .run(targetUser.id);
        }

        this.db
          .prepare(
            "UPDATE admin_recovery_requests SET status = 'COMPLETED', reviewed_by_admin_id = ?, verification_notes = ?, completed_at = ?, updated_at = ? WHERE id = ?"
          )
          .run(adminUser.id, payload.notes.trim(), nowIso, nowIso, requestId);

        this.recordSecurityEvent({
          userId: targetUser.id,
          actorId: adminUser.id,
          eventType: 'ADMIN_RECOVERY_COMPLETED',
          severity: 'critical',
          summary: `Administrator approved and completed ${requestType} request ${requestId}.`,
        });

        this.academicService.writeAuditLog({
          actorId: adminUser.id,
          actorName: adminUser.name,
          actorRole: 'admin',
          action: 'ADMIN_RECOVERY_REQUEST_COMPLETED',
          targetType: 'admin_recovery_requests',
          targetId: requestId,
          details: { targetUserId: targetUser.id, requestType, notes: payload.notes.trim() },
        });
      });

      this.dispatchSecurityAlert({
        user: this.academicService.getUserById(targetUser.id)!,
        headline: 'Administrator Recovery Action Completed',
        summary: `An administrator verified and completed your ${requestType.replace('_', ' ')} request (${requestId}).`,
        dedupePrefix: `admapp-${requestId}`,
      });
    }

    return this.listAdminRecoveryRequests(adminUser).find((r) => r.id === requestId)!;
  }

  // --- Unified Account & Security Status Readout ---
  public getAccountSecurityStatus(user: UserAccount, currentJti?: string): AccountSecurityStatus {
    const contactRows = this.db
      .prepare('SELECT * FROM verified_recovery_contacts WHERE user_id = ? ORDER BY is_primary DESC, updated_at DESC')
      .all(user.id) as Record<string, unknown>[];
    const contacts: VerifiedRecoveryContact[] = contactRows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      channel: String(r.channel) as RecoveryChannel,
      contactValue: String(r.contact_value),
      isPrimary: Number(r.is_primary) === 1,
      verified: Number(r.verified) === 1,
      verifiedAt: r.verified_at ? String(r.verified_at) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));

    const changeRows = this.db
      .prepare("SELECT * FROM contact_change_requests WHERE user_id = ? AND status = 'PENDING' ORDER BY created_at DESC")
      .all(user.id) as Record<string, unknown>[];
    const pendingContactChanges: ContactChangeRequestRecord[] = changeRows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      channel: String(r.channel) as RecoveryChannel,
      oldContact: String(r.old_contact),
      newContact: String(r.new_contact),
      status: String(r.status) as ContactChangeRequestRecord['status'],
      expiresAt: String(r.expires_at),
      completedAt: r.completed_at ? String(r.completed_at) : null,
      createdAt: String(r.created_at),
    }));

    const enrRow = this.getTotpEnrollmentRow(user.id);
    const backupRemaining = (
      this.db
        .prepare('SELECT COUNT(*) as cnt FROM totp_backup_codes WHERE user_id = ? AND used_at IS NULL')
        .get(user.id) as { cnt: number }
    ).cnt;

    const totpSummary: TotpEnrollmentSummary = {
      status: enrRow
        ? (String(enrRow.status) as TotpEnrollmentSummary['status'])
        : user.totpEnabled
        ? 'ACTIVE'
        : 'NOT_ENROLLED',
      guardianAssisted: enrRow ? Number(enrRow.guardian_assisted) === 1 : false,
      verifiedAt: enrRow?.verified_at ? String(enrRow.verified_at) : user.totpEnrolledAt ?? null,
      backupCodesRemaining: Number(backupRemaining || 0),
      mandatoryForRole: user.role !== 'admin' && process.env.TOTP_MANDATORY_NON_ADMIN !== 'false',
      lockedUntil: enrRow?.locked_until ? String(enrRow.locked_until) : null,
    };

    const eventRows = this.db
      .prepare('SELECT * FROM security_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
      .all(user.id) as Record<string, unknown>[];
    const recentSecurityEvents: SecurityEventRecord[] = eventRows.map((r) => ({
      id: String(r.id),
      userId: r.user_id ? String(r.user_id) : null,
      actorId: r.actor_id ? String(r.actor_id) : null,
      eventType: String(r.event_type),
      severity: String(r.severity) as SecurityEventRecord['severity'],
      channel: r.channel ? String(r.channel) : null,
      ipAddress: r.ip_address ? String(r.ip_address) : null,
      summary: String(r.summary),
      metadataJson: String(r.metadata_json),
      createdAt: String(r.created_at),
    }));

    const pendingReqRows = this.db
      .prepare('SELECT * FROM admin_recovery_requests WHERE target_user_id = ? ORDER BY created_at DESC LIMIT 10')
      .all(user.id) as Record<string, unknown>[];
    const pendingRecoveryRequests: AdminRecoveryRequestRecord[] = pendingReqRows.map((r) => ({
      id: String(r.id),
      targetUserId: String(r.target_user_id),
      requestType: String(r.request_type) as AdminRecoveryRequestRecord['requestType'],
      requesterIdentifier: String(r.requester_identifier),
      verificationNotes: String(r.verification_notes),
      status: String(r.status) as AdminRecoveryRequestRecord['status'],
      requestedByUserId: r.requested_by_user_id ? String(r.requested_by_user_id) : null,
      reviewedByAdminId: r.reviewed_by_admin_id ? String(r.reviewed_by_admin_id) : null,
      cooldownUntil: r.cooldown_until ? String(r.cooldown_until) : null,
      completedAt: r.completed_at ? String(r.completed_at) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));

    const linkedChildren =
      user.role === 'parent'
        ? (
            this.db
              .prepare("SELECT id, name, user_id_code, totp_enabled, grade FROM users WHERE role = 'student' AND guardian_user_id = ?")
              .all(user.id) as Record<string, unknown>[]
          ).map((c) => ({
            id: String(c.id),
            name: String(c.name),
            userIdCode: String(c.user_id_code),
            totpEnabled: Number(c.totp_enabled) === 1,
            grade: String(c.grade || 'Grade 5'),
          }))
        : [];

    let linkedGuardian: AccountSecurityStatus['linkedGuardian'] = null;
    if (user.guardianUserId) {
      const gRow = this.db
        .prepare('SELECT id, name, email, whatsapp_number FROM users WHERE id = ?')
        .get(user.guardianUserId) as Record<string, unknown> | undefined;
      if (gRow) {
        linkedGuardian = {
          id: String(gRow.id),
          name: String(gRow.name),
          email: maskEmail(String(gRow.email)),
          whatsappNumber: maskPhoneNumber(String(gRow.whatsapp_number)),
        };
      }
    }

    return {
      userId: user.id,
      userIdCode: user.userIdCode,
      username: user.username || user.userIdCode.toLowerCase(),
      usernameUpdatedAt: user.usernameUpdatedAt ?? null,
      role: user.role,
      email: user.email,
      emailVerified: user.emailVerified,
      whatsappNumber: user.whatsappNumber,
      whatsappVerified: user.whatsappVerified ?? true,
      passwordUpdatedAt: user.passwordUpdatedAt ?? null,
      totp: totpSummary,
      contacts,
      pendingContactChanges,
      activeSessions: this.listSessions(user.id, currentJti),
      recentSecurityEvents,
      pendingRecoveryRequests,
      notificationPreferences: user.notificationPreferences || {
        inApp: true,
        email: true,
        whatsapp: true,
        groupedSummary: false,
      },
      linkedChildren,
      linkedGuardian,
    };
  }
}
