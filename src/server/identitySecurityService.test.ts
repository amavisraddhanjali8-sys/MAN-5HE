import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Man5heDatabase } from './db.ts';
import { AcademicService } from './academicService.ts';
import {
  IdentitySecurityService,
  type DispatchedOtpEvent,
} from './identitySecurityService.ts';
import { generateTotpCode, verifyPassword } from '../lib/security.ts';

function setupTempHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'man5he-sec-'));
  const sqlitePath = path.join(dir, 'test.sqlite');
  const dbWrapper = new Man5heDatabase(sqlitePath);
  const academicService = new AcademicService(dbWrapper);
  const dispatched: DispatchedOtpEvent[] = [];
  let currentNowMs = 1_795_000_000_000;

  process.env.RECOVERY_RESEND_COOLDOWN_SECONDS = '30';
  process.env.RECOVERY_OTP_TTL_SECONDS = '300';
  process.env.USERNAME_CHANGE_COOLDOWN_HOURS = '24';
  process.env.ADMIN_RECOVERY_KEY = 'MAN5HE-SUPER-PROTECTED-ADMIN-KEY-2026';

  const identityService = new IdentitySecurityService(dbWrapper, academicService, {
    nowFn: () => currentNowMs,
    onDispatchOtp: (ev) => dispatched.push(ev),
  });

  return {
    dir,
    dbWrapper,
    academicService,
    identityService,
    dispatched,
    getNow: () => currentNowMs,
    advanceSeconds: (s: number) => {
      currentNowMs += s * 1000;
    },
    cleanup: () => {
      try {
        dbWrapper.db.close();
      } catch {
        // ignore
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('Enhancement 04: Secure Account Recovery, Contacts, Profile & Google Authenticator', () => {
  let ctx: ReturnType<typeof setupTempHarness>;

  beforeEach(() => {
    ctx = setupTempHarness();
  });

  after(() => {
    // individual tests clean up their harnesses
  });

  it('1-3. recovers password via registered verified Email & WhatsApp without exposing OTPs in logs or allowing arbitrary destinations', () => {
    try {
      const { identityService, dispatched, dbWrapper, academicService } = ctx;
      const req = identityService.requestRecoveryChallenge({
        identifier: 'kasun@man5he.lk',
        channel: 'email',
      });
      assert.equal(req.accepted, true);
      assert.equal(dispatched.length, 1);
      assert.equal(dispatched[0].destination, 'kasun@man5he.lk');
      const emailOtp = dispatched[0].otpCode;
      assert.match(emailOtp, /^\d{6}$/);

      // Ensure plaintext OTP is NEVER stored in email_logs, security_events, or verification_challenges
      const emailRows = JSON.stringify(dbWrapper.db.prepare('SELECT * FROM email_logs').all());
      const challengeRows = JSON.stringify(
        dbWrapper.db.prepare('SELECT * FROM verification_challenges').all()
      );
      const eventRows = JSON.stringify(dbWrapper.db.prepare('SELECT * FROM security_events').all());
      assert.equal(emailRows.includes(emailOtp), false);
      assert.equal(challengeRows.includes(emailOtp), false);
      assert.equal(eventRows.includes(emailOtp), false);

      // Issue a WhatsApp challenge and confirm previous challenge is invalidated
      ctx.advanceSeconds(35);
      const waReq = identityService.requestRecoveryChallenge({
        identifier: 'm5-2026-002',
        channel: 'whatsapp',
      });
      assert.equal(waReq.accepted, true);
      assert.equal(dispatched.length, 2);
      assert.equal(dispatched[1].channel, 'whatsapp');
      const waOtp = dispatched[1].otpCode;
      const waRows = JSON.stringify(dbWrapper.db.prepare('SELECT * FROM whatsapp_logs').all());
      assert.equal(waRows.includes(waOtp), false);
      assert.equal(dispatched[1].whatsappPayload?.templateName, 'man5he_auth_otp_v1');

      // Old email OTP is now invalidated
      assert.throws(() => {
        identityService.verifyRecoveryChallenge({
          challengeId: req.challengeId,
          otpCode: emailOtp,
        });
      });

      // Wrong OTP increments attempts and rejects
      assert.throws(() => {
        identityService.verifyRecoveryChallenge({
          challengeId: waReq.challengeId,
          otpCode: '000000',
        });
      });

      // Valid WhatsApp OTP grants short-lived reset token & updates password + revokes sessions
      const kasun = academicService.getUserByIdentifier('kasun@man5he.lk')!;
      identityService.createAuthSession({
        userId: kasun.id,
        tokenJti: 'jti-active-1',
        expiresAtMs: ctx.getNow() + 600_000,
      });
      assert.equal(identityService.isSessionValid(kasun.id, 'jti-active-1'), true);

      const verified = identityService.verifyRecoveryChallenge({
        challengeId: waReq.challengeId,
        otpCode: waOtp,
      });
      const resetRes = identityService.completePasswordReset({
        resetToken: verified.resetToken,
        newPassword: 'LankaScholar#992!',
      });
      assert.equal(resetRes.ok, true);
      assert.equal(resetRes.sessionsRevoked >= 1, true);
      assert.equal(identityService.isSessionValid(kasun.id, 'jti-active-1'), false);

      const refreshed = academicService.getUserById(kasun.id)!;
      assert.equal(verifyPassword('LankaScholar#992!', refreshed.passwordHash), true);
    } finally {
      ctx.cleanup();
    }
  });

  it('4-5. prevents enumeration on non-existent & admin identifiers and rejects expired / locked-out challenges', () => {
    try {
      const { identityService, dispatched } = ctx;
      const missing = identityService.requestRecoveryChallenge({
        identifier: 'nobody-exists@man5he.lk',
        channel: 'email',
      });
      const adminBlocked = identityService.requestRecoveryChallenge({
        identifier: 'admin@man5he.lk',
        channel: 'email',
      });
      assert.equal(missing.accepted, true);
      assert.equal(adminBlocked.accepted, true);
      assert.equal(missing.message, adminBlocked.message);
      assert.equal(dispatched.length, 0);

      // Cooldown enforcement
      const first = identityService.requestRecoveryChallenge({
        identifier: 'kasun@man5he.lk',
        channel: 'email',
      });
      assert.throws(() => {
        identityService.requestRecoveryChallenge({
          identifier: 'kasun@man5he.lk',
          channel: 'email',
        });
      });

      // Expiry enforcement
      ctx.advanceSeconds(310);
      assert.throws(() => {
        identityService.verifyRecoveryChallenge({
          challengeId: first.challengeId,
          otpCode: dispatched[0].otpCode,
        });
      });
    } finally {
      ctx.cleanup();
    }
  });

  it('6-9. enforces TOTP during password reset when enabled, password reuse check, username cooldown/immutable ID, and verified contact change', async () => {
    try {
      const { identityService, academicService, dispatched } = ctx;
      const teacher = academicService.getUserByIdentifier('teacher.math@man5he.lk')!;

      // Enroll TOTP cleanly (encrypted secret + 1-step confirm + 8 backup codes)
      const setup = await identityService.startTotpEnrollment(teacher);
      assert.ok(setup.manualKey.length >= 16);
      assert.ok(setup.qrDataUrl.startsWith('data:image/png;base64,'));

      // Stored secret must be encrypted at rest
      const rawRow = ctx.dbWrapper.db
        .prepare('SELECT totp_secret FROM users WHERE id = ?')
        .get(teacher.id) as { totp_secret: string };
      assert.ok(rawRow.totp_secret.startsWith('enc:v1:'));

      // Wrong code fails
      assert.throws(() => {
        identityService.confirmTotpEnrollment(teacher, { code: '000000' });
      });

      // Confirm enrollment
      const validCode = generateTotpCode(setup.manualKey, ctx.getNow());
      const confirmRes = identityService.confirmTotpEnrollment(teacher, { code: validCode });
      assert.equal(confirmRes.enabled, true);
      assert.equal(confirmRes.backupCodes.length, 8);

      // Time-step replay is blocked on verifyTotpForUser
      const enrolledTeacher = academicService.getUserById(teacher.id)!;
      const replayCheck = identityService.verifyTotpForUser(enrolledTeacher, validCode);
      assert.equal(replayCheck.valid, false);

      // Password reset via email OTP CANNOT succeed without TOTP/backup code
      ctx.advanceSeconds(35);
      identityService.requestRecoveryChallenge({
        identifier: 'teacher.math@man5he.lk',
        channel: 'email',
      });
      const recOtp = dispatched[dispatched.length - 1].otpCode;
      const chRow = ctx.dbWrapper.db
        .prepare("SELECT id FROM verification_challenges WHERE user_id = ? AND purpose = 'password_recovery' ORDER BY created_at DESC LIMIT 1")
        .get(teacher.id) as { id: string };
      const v = identityService.verifyRecoveryChallenge({
        challengeId: chRow.id,
        otpCode: recOtp,
      });
      assert.equal(v.requiresTotp, true);
      assert.throws(() => {
        identityService.completePasswordReset({
          resetToken: v.resetToken,
          newPassword: 'BrandNewPassword#2027',
        });
      });

      // Completing reset using fresh TOTP succeeds and blocks reuse of recent password
      ctx.advanceSeconds(35);
      const freshTotp = generateTotpCode(setup.manualKey, ctx.getNow());
      identityService.completePasswordReset({
        resetToken: v.resetToken,
        newPassword: 'BrandNewPassword#2027',
        totpCode: freshTotp,
      });
      assert.throws(() => {
        identityService.changePassword(academicService.getUserById(teacher.id)!, {
          currentPassword: 'BrandNewPassword#2027',
          newPassword: 'BrandNewPassword#2027',
          totpCode: generateTotpCode(setup.manualKey, ctx.getNow() + 30_000),
        });
      });

      // Username update keeps immutable user_id_code & respects reserved/uniqueness/cooldown rules
      ctx.advanceSeconds(65);
      const tAfterPw = academicService.getUserById(teacher.id)!;
      assert.throws(() => {
        identityService.changeUsername(tAfterPw, {
          newUsername: 'administrator',
          currentPassword: 'BrandNewPassword#2027',
        });
      });
      const renamed = identityService.changeUsername(tAfterPw, {
        newUsername: 'nimali.math5',
        currentPassword: 'BrandNewPassword#2027',
        totpCode: generateTotpCode(setup.manualKey, ctx.getNow()),
      });
      assert.equal(renamed.id, teacher.id);
      assert.equal(renamed.userIdCode, teacher.userIdCode);
      assert.equal(renamed.username, 'nimali.math5');

      // Cooldown blocks second immediate change
      assert.throws(() => {
        identityService.changeUsername(renamed, {
          newUsername: 'nimali.math6',
          currentPassword: 'BrandNewPassword#2027',
        });
      });

      // Verified email contact change sends OTP to NEW email before updating DB
      ctx.advanceSeconds(35);
      const contactReq = identityService.requestContactChange(renamed, {
        channel: 'email',
        newContact: 'nimali.new@man5he.lk',
        currentPassword: 'BrandNewPassword#2027',
        totpCode: generateTotpCode(setup.manualKey, ctx.getNow()),
      });
      assert.equal(contactReq.escalatedToAdmin, false);
      const newEmailOtp = dispatched[dispatched.length - 1];
      assert.equal(newEmailOtp.destination, 'nimali.new@man5he.lk');
      assert.equal(academicService.getUserById(teacher.id)!.email, 'teacher.math@man5he.lk');

      const afterContact = identityService.confirmContactChange(renamed, {
        requestId: contactReq.requestId,
        otpCode: newEmailOtp.otpCode,
      });
      assert.equal(afterContact.email, 'nimali.new@man5he.lk');

      // Single-use backup code works once to recover authenticator & fails second time
      ctx.advanceSeconds(35);
      const recAuth = await identityService.recoverAuthenticator({
        identifier: 'nimali.math5',
        password: 'BrandNewPassword#2027',
        mode: 'backup_code',
        backupCode: confirmRes.backupCodes[0],
      });
      assert.equal(recAuth.recovered, true);
      assert.ok(recAuth.setup?.manualKey);
      assert.equal(identityService.consumeBackupCode(teacher.id, confirmRes.backupCodes[0]), false);
    } finally {
      ctx.cleanup();
    }
  });

  it('10-12. enforces guardian-assisted student TOTP recovery, rejects non-guardians, isolates admins, and executes protected admin recovery + recovery queue', async () => {
    try {
      const { identityService, academicService } = ctx;
      const parent = academicService.getUserByIdentifier('parent@man5he.lk')!;
      const student = academicService.getUserByIdentifier('sayuri@man5he.lk')!;
      const otherStudent = academicService.getUserByIdentifier('kasun@man5he.lk')!;
      const admin = academicService.getUserByIdentifier('admin@man5he.lk')!;

      // Parent can enroll child Sayuri's authenticator
      const childSetup = await identityService.startTotpEnrollment(parent, {
        targetStudentId: student.id,
      });
      assert.equal(childSetup.guardianAssisted, true);
      const childCode = generateTotpCode(childSetup.manualKey, ctx.getNow());
      const childConfirm = identityService.confirmTotpEnrollment(parent, {
        code: childCode,
        targetStudentId: student.id,
      });
      assert.equal(childConfirm.guardianAssisted, true);

      // Non-linked student CANNOT manage or reset another student's TOTP
      await assert.rejects(async () => {
        await identityService.startTotpEnrollment(otherStudent, { targetStudentId: student.id });
      });

      // Guardian-assisted child reset succeeds
      const childReset = await identityService.guardianRecoverChildTotp(parent, {
        studentId: student.id,
        parentPassword: 'Parent@2026',
      });
      assert.equal(childReset.setup.guardianAssisted, true);

      // Admin cannot use non-admin self-service TOTP enrollment or authenticator recovery
      await assert.rejects(async () => {
        await identityService.startTotpEnrollment(admin);
      });
      await assert.rejects(async () => {
        await identityService.recoverAuthenticator({
          identifier: 'admin@man5he.lk',
          password: 'Admin@2026',
          mode: 'admin_request',
        });
      });

      // Protected admin recovery key works only with valid ADMIN_RECOVERY_KEY
      assert.throws(() => {
        identityService.completeProtectedAdminRecovery({
          identifier: 'admin@man5he.lk',
          adminRecoveryKey: 'wrong-key-value-1234',
          newPassword: 'SovereignRoot#2027!',
        });
      });
      const admRes = identityService.completeProtectedAdminRecovery({
        identifier: 'admin@man5he.lk',
        adminRecoveryKey: 'MAN5HE-SUPER-PROTECTED-ADMIN-KEY-2026',
        newPassword: 'SovereignRoot#2027!',
      });
      assert.equal(admRes.ok, true);

      // Lost-contact escalation creates auditable PENDING_APPROVAL admin queue item & updates after approval
      const freshStudent = academicService.getUserById(student.id)!;
      const escalation = identityService.requestContactChange(freshStudent, {
        channel: 'whatsapp',
        newContact: '+94779998877',
        currentPassword: 'Sayuri@2026',
        lostOldContact: true,
        verificationNotes: 'Parent SIM card replaced at Dialog outlet',
      });
      assert.equal(escalation.escalatedToAdmin, true);

      const queue = identityService.listAdminRecoveryRequests(admin);
      assert.equal(queue.some((q) => q.id === escalation.requestId && q.status === 'PENDING_APPROVAL'), true);

      const approved = identityService.reviewAdminRecoveryRequest(admin, escalation.requestId, {
        decision: 'APPROVE',
        notes: 'Verified parent NIC and student birth certificate over phone.',
      });
      assert.equal(approved.status, 'COMPLETED');
      assert.equal(academicService.getUserById(student.id)!.whatsappNumber, '+94779998877');

      // Security events contain zero sensitive secrets or OTP values
      const secEvents = JSON.stringify(
        ctx.dbWrapper.db.prepare('SELECT summary, metadata_json FROM security_events').all()
      );
      assert.equal(secEvents.includes('AdminStrong#2027!'), false);
      assert.equal(secEvents.includes('MAN5HE-SUPER-PROTECTED-ADMIN-KEY-2026'), false);
      assert.equal(secEvents.includes(childSetup.manualKey), false);
    } finally {
      ctx.cleanup();
    }
  });
});
