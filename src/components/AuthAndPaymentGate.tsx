import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  KeyRound,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { api, AuthUser, setStoredToken } from '../lib/api';
import type { EmailLog, InvoiceRecord, PaymentPlan } from '../lib/types';
import { Man5heLogo, MascotAvatar } from './BrandVisuals';

interface AuthAndPaymentGateProps {
  onAuthenticated: (user: AuthUser, opts?: { totpEnrollmentRequired?: boolean }) => void;
  existingUser?: AuthUser | null;
  paymentModeOnly?: boolean;
  onPaymentComplete?: (user: AuthUser, invoice: InvoiceRecord) => void;
  onBackToDashboard?: () => void;
}

export function AuthAndPaymentGate({
  onAuthenticated,
  existingUser,
  paymentModeOnly = false,
  onPaymentComplete,
  onBackToDashboard,
}: AuthAndPaymentGateProps) {
  const [authTab, setAuthTab] = useState<'login' | 'register' | 'recover_pw' | 'recover_totp'>('login');

  // CAPTCHA + Robot check
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaSvg, setCaptchaSvg] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [humanChecked, setHumanChecked] = useState(false);
  const [honeypotValue, setHoneypotValue] = useState('');

  // Login state
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginChallengeId, setLoginChallengeId] = useState<string | null>(null);
  const [loginStep2Flags, setLoginStep2Flags] = useState<{
    requireEmailOtp: boolean;
    requireTotp: boolean;
  }>({ requireEmailOtp: true, requireTotp: true });
  const [loginEmailOtp, setLoginEmailOtp] = useState('');
  const [loginTotpCode, setLoginTotpCode] = useState('');

  // Password Recovery (Email / WhatsApp) state
  const [recIdentifier, setRecIdentifier] = useState('');
  const [recChannel, setRecChannel] = useState<'email' | 'whatsapp'>('email');
  const [recChallengeId, setRecChallengeId] = useState<string | null>(null);
  const [recOtpCode, setRecOtpCode] = useState('');
  const [recResetToken, setRecResetToken] = useState<string | null>(null);
  const [recRequiresTotp, setRecRequiresTotp] = useState(false);
  const [recTotpOrBackup, setRecTotpOrBackup] = useState('');
  const [recNewPassword, setRecNewPassword] = useState('');

  // Authenticator Recovery (Backup code / Admin request) state
  const [authRecIdentifier, setAuthRecIdentifier] = useState('');
  const [authRecPassword, setAuthRecPassword] = useState('');
  const [authRecMode, setAuthRecMode] = useState<'backup_code' | 'admin_request'>('backup_code');
  const [authRecBackupCode, setAuthRecBackupCode] = useState('');
  const [authRecReason, setAuthRecReason] = useState('');
  const [authRecSetupQr, setAuthRecSetupQr] = useState<{
    qrDataUrl: string;
    manualKey: string;
  } | null>(null);

  // Registration state
  const [regUserIdCode, setRegUserIdCode] = useState('M5-2026-108');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regWhatsapp, setRegWhatsapp] = useState('+9477');
  const [regPassword, setRegPassword] = useState('');
  const [regStep2, setRegStep2] = useState<{
    registrationId: string;
    totpSecret: string;
    qrDataUrl: string;
  } | null>(null);
  const [regEmailOtp, setRegEmailOtp] = useState('');
  const [regTotpCode, setRegTotpCode] = useState('');

  // Sandbox verification inbox & demo authenticator pairing
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxEmails, setInboxEmails] = useState<EmailLog[]>([]);
  const [selectedEmailPreview, setSelectedEmailPreview] = useState<EmailLog | null>(null);
  const [demoHelper, setDemoHelper] = useState<{
    userIdCode: string;
    email: string;
    totpSecret: string;
    qrDataUrl: string;
    currentCode: string;
  } | null>(null);

  // Payment checkout state
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('plan-term');
  const [gateway, setGateway] = useState<'PayHere LKR' | 'Stripe Card'>('PayHere LKR');
  const [paymentOtpChallengeId, setPaymentOtpChallengeId] = useState<string | null>(null);
  const [paymentEmailOtp, setPaymentEmailOtp] = useState('');
  const [paymentTotpCode, setPaymentTotpCode] = useState('');
  const [confirmedInvoice, setConfirmedInvoice] = useState<InvoiceRecord | null>(null);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const loadCaptcha = async () => {
    try {
      const c = await api.getCaptcha();
      setCaptchaToken(c.captchaToken);
      setCaptchaSvg(c.svgMarkup);
      setCaptchaAnswer('');
    } catch {
      // handled silently
    }
  };

  const refreshSandboxInbox = async (emailFilter?: string) => {
    try {
      const res = await api.getSandboxInbox(emailFilter);
      setInboxEmails(res.emails);
      if (res.emails.length > 0 && !selectedEmailPreview) {
        setSelectedEmailPreview(res.emails[0]);
      }
    } catch {
      // ignore
    }
  };

  const [mfaConfig, setMfaConfig] = useState<{
    enableEmailOtp: boolean;
    enableTotp: boolean;
    mfaRequired: boolean;
  }>({ enableEmailOtp: false, enableTotp: false, mfaRequired: false });

  useEffect(() => {
    api
      .getAuthConfig()
      .then((cfg) => setMfaConfig(cfg))
      .catch(() => {});
    if (!paymentModeOnly) {
      loadCaptcha();
    } else {
      api.getPlans().then((r) => setPlans(r.plans)).catch(() => {});
    }
    refreshSandboxInbox();
  }, [paymentModeOnly]);

  const [totpSecondsRemaining, setTotpSecondsRemaining] = useState(
    () => 30 - (Math.floor(Date.now() / 1000) % 30)
  );

  useEffect(() => {
    if (!demoHelper) return;
    const interval = window.setInterval(() => {
      const rem = 30 - (Math.floor(Date.now() / 1000) % 30);
      setTotpSecondsRemaining(rem);
      if (rem >= 29 || rem <= 2) {
        api
          .getDemoTotpHelper(demoHelper.email)
          .then((h) => setDemoHelper(h))
          .catch(() => {});
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [demoHelper?.email]);

  const handleAutofillDemo = async (role: 'student' | 'parent' | 'teacher' | 'admin') => {
    setErrorMsg(null);
    const id =
      role === 'student'
        ? 'sayuri@man5he.lk'
        : role === 'parent'
        ? 'parent@man5he.lk'
        : role === 'teacher'
        ? 'teacher.math@man5he.lk'
        : 'admin@man5he.lk';
    const pw =
      role === 'student'
        ? 'Sayuri@2026'
        : role === 'parent'
        ? 'Parent@2026'
        : role === 'teacher'
        ? 'Teacher@2026'
        : 'Admin@2026';
    setAuthTab('login');
    setLoginIdentifier(id);
    setLoginPassword(pw);
    setLoginChallengeId(null);
    setInfoMsg(
      mfaConfig.mfaRequired
        ? `Loaded ${role} credentials. Solve the SVG CAPTCHA, tick the robot check, and continue to verification.`
        : `Loaded ${role} credentials. Solve the SVG CAPTCHA, tick the robot check, and click Sign In.`
    );
    if (mfaConfig.enableTotp) {
      try {
        const helper = await api.getDemoTotpHelper(id);
        setDemoHelper(helper);
      } catch {
        setDemoHelper(null);
      }
    } else {
      setDemoHelper(null);
    }
  };

  const handleLoginStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const res = await api.loginStep1({
        identifier: loginIdentifier,
        password: loginPassword,
        captchaToken,
        captchaAnswer,
        honeypotValue,
        humanChecked,
      });
      if (!res.mfaRequired && res.token && res.user) {
        setStoredToken(res.token);
        onAuthenticated(res.user, { totpEnrollmentRequired: res.totpEnrollmentRequired });
        return;
      }
      if (res.loginChallengeId) {
        setLoginChallengeId(res.loginChallengeId);
        setLoginStep2Flags({
          requireEmailOtp: res.requireEmailOtp !== false,
          requireTotp: res.requireTotp !== false,
        });
        setInfoMsg(res.message || 'Enter your Email OTP and Google Authenticator code.');
        if (res.requireEmailOtp !== false) {
          await refreshSandboxInbox(res.maskedEmail);
          setInboxOpen(true);
        }
        if (
          (mfaConfig.enableTotp || res.requireTotp) &&
          [
            'sayuri@man5he.lk',
            'm5-2026-001',
            'parent@man5he.lk',
            'm5-par-01',
            'admin@man5he.lk',
            'm5-admin-01',
          ].includes(loginIdentifier.trim().toLowerCase())
        ) {
          const helper = await api.getDemoTotpHelper(loginIdentifier.trim()).catch(() => null);
          if (helper) setDemoHelper(helper);
        }
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
      loadCaptcha();
    } finally {
      setBusy(false);
    }
  };

  const handleLoginStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginChallengeId) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const res = await api.loginStep2({
        loginChallengeId,
        emailOtp: loginEmailOtp,
        totpCode: loginTotpCode,
      });
      setStoredToken(res.token);
      onAuthenticated(res.user, { totpEnrollmentRequired: res.totpEnrollmentRequired });
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRequestRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const res = await api.requestPasswordRecovery({
        identifier: recIdentifier,
        channel: recChannel,
        resendChallengeId: recChallengeId || undefined,
      });
      setRecChallengeId(res.challengeId);
      setInfoMsg(res.message);
      if (recChannel === 'email') {
        await refreshSandboxInbox();
        setInboxOpen(true);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyRecoveryOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recChallengeId) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const isBackup = recTotpOrBackup.trim().toUpperCase().startsWith('M5RC-');
      const res = await api.verifyRecoveryChallenge({
        challengeId: recChallengeId,
        identifier: recIdentifier,
        otpCode: recOtpCode,
        totpCode: !isBackup && recTotpOrBackup ? recTotpOrBackup : undefined,
        backupCode: isBackup ? recTotpOrBackup : undefined,
      });
      setRecResetToken(res.resetToken);
      setRecRequiresTotp(res.requiresTotp);
      setInfoMsg(
        res.requiresTotp
          ? 'Recovery code verified. Enter your Google Authenticator code (or backup code) and new password.'
          : 'Recovery code verified. Choose your new strong password.'
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteRecoveryReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recResetToken) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const isBackup = recTotpOrBackup.trim().toUpperCase().startsWith('M5RC-');
      const res = await api.completePasswordReset({
        resetToken: recResetToken,
        newPassword: recNewPassword,
        totpCode: !isBackup && recTotpOrBackup ? recTotpOrBackup : undefined,
        backupCode: isBackup ? recTotpOrBackup : undefined,
      });
      setRecChallengeId(null);
      setRecResetToken(null);
      setRecOtpCode('');
      setRecNewPassword('');
      setRecTotpOrBackup('');
      setAuthTab('login');
      setInfoMsg(
        `Password updated successfully (${res.sessionsRevoked} session(s) revoked). Sign in with your new password.`
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRecoverAuthenticator = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const res = await api.recoverAuthenticator({
        identifier: authRecIdentifier,
        password: authRecPassword,
        mode: authRecMode,
        backupCode: authRecMode === 'backup_code' ? authRecBackupCode : undefined,
        reason: authRecMode === 'admin_request' ? authRecReason : undefined,
      });
      if (res.setup) {
        setAuthRecSetupQr({ qrDataUrl: res.setup.qrDataUrl, manualKey: res.setup.manualKey });
      }
      setInfoMsg(res.message);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterInit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const res = await api.registerInit({
        userIdCode: regUserIdCode,
        name: regName,
        email: regEmail,
        whatsappNumber: regWhatsapp,
        password: regPassword,
        captchaToken,
        captchaAnswer,
        honeypotValue,
        humanChecked,
      });
      if (!res.mfaRequired && res.token && res.user) {
        setStoredToken(res.token);
        onAuthenticated(res.user, { totpEnrollmentRequired: res.totpEnrollmentRequired });
        return;
      }
      if (res.registrationId && res.totpSecret && res.qrDataUrl) {
        setRegStep2({
          registrationId: res.registrationId,
          totpSecret: res.totpSecret,
          qrDataUrl: res.qrDataUrl,
        });
        setInfoMsg(res.message || 'Verification codes sent.');
        await refreshSandboxInbox(regEmail);
        setInboxOpen(true);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
      loadCaptcha();
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regStep2) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const res = await api.registerVerify({
        registrationId: regStep2.registrationId,
        emailOtp: regEmailOtp,
        totpCode: regTotpCode,
      });
      setStoredToken(res.token);
      onAuthenticated(res.user, { totpEnrollmentRequired: res.totpEnrollmentRequired });
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRequestPaymentOtp = async () => {
    setErrorMsg(null);
    setBusy(true);
    try {
      const res = await api.requestPaymentOtp();
      setPaymentOtpChallengeId(res.paymentOtpChallengeId);
      setInfoMsg(res.message);
      await refreshSandboxInbox(existingUser?.email);
      setInboxOpen(true);
      if (existingUser && mfaConfig.enableTotp) {
        api
          .getDemoTotpHelper(existingUser.email)
          .then((h) => setDemoHelper(h))
          .catch(() => {});
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleProcessPaidCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mfaConfig.enableEmailOtp && !paymentOtpChallengeId) {
      setErrorMsg('Please request a Payment Email OTP first.');
      return;
    }
    setErrorMsg(null);
    setBusy(true);
    try {
      const { checkoutPayload } = await api.createCheckout({
        planId: selectedPlanId,
        gateway,
        paymentOtpChallengeId: paymentOtpChallengeId || undefined,
        emailOtp: paymentEmailOtp || undefined,
        totpCode: paymentTotpCode || undefined,
      });
      const confirmed = await api.confirmCheckoutWebhook({
        orderId: checkoutPayload.orderId,
        signature: checkoutPayload.signature,
      });
      setConfirmedInvoice(confirmed.invoice);
      setInfoMsg(
        `Payment confirmed via ${gateway}. Official Invoice ${confirmed.invoice.invoiceNumber} emailed!`
      );
      await refreshSandboxInbox(existingUser?.email);
      onPaymentComplete?.(confirmed.user, confirmed.invoice);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (paymentModeOnly && existingUser) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="bg-white rounded-2xl border border-[#DCEBFA] p-6 sm:p-8 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-[#E5F0FA]">
            <div>
              <h2 className="text-2xl font-display font-bold text-[#0F2942]">
                Secured Scholarship Subscription & Billing
              </h2>
              <p className="text-sm text-[#526A84] mt-1">
                Account: {existingUser.name} · {existingUser.userIdCode} · Status:{' '}
                <span className="font-semibold text-[#158EE3]">
                  {existingUser.subscriptionStatus === 'active'
                    ? 'Active Paid Scholar'
                    : 'Trial Preview'}
                </span>
              </p>
            </div>
            {onBackToDashboard && (
              <button
                type="button"
                onClick={onBackToDashboard}
                className="px-4 py-2 text-sm font-medium text-[#0F2942] bg-[#F3F9FF] border border-[#CBE2FA] rounded-xl hover:bg-[#E5F2FF] transition-colors whitespace-nowrap shrink-0"
              >
                Back to Dashboard
              </button>
            )}
          </div>

          {errorMsg && (
            <div className="mt-4 p-3.5 rounded-xl bg-[#FFF2ED] border border-[#FAC5B2] text-sm text-[#9A2F09] font-medium">
              {errorMsg}
            </div>
          )}
          {infoMsg && (
            <div className="mt-4 p-3.5 rounded-xl bg-[#EDF8EE] border border-[#B7E1BA] text-sm text-[#1E6323] font-medium">
              {infoMsg}
            </div>
          )}

          {confirmedInvoice ? (
            <div className="mt-6 p-6 rounded-2xl bg-[#F3F9FF] border border-[#CBE2FA]">
              <div className="flex items-center gap-3 text-[#2E7D32]">
                <CheckCircle2 className="w-6 h-6" />
                <h3 className="text-xl font-display font-bold">
                  Invoice {confirmedInvoice.invoiceNumber} Paid & Verified
                </h3>
              </div>
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-[#526A84]">Plan</div>
                  <div className="font-semibold text-[#0F2942]">{confirmedInvoice.planName}</div>
                </div>
                <div>
                  <div className="text-[#526A84]">Amount</div>
                  <div className="font-semibold text-[#F96A1B] tabular-nums">
                    LKR {confirmedInvoice.amountLkr.toLocaleString('en-LK')}.00
                  </div>
                </div>
                <div>
                  <div className="text-[#526A84]">Gateway</div>
                  <div className="font-semibold text-[#0F2942]">{confirmedInvoice.gateway}</div>
                </div>
                <div>
                  <div className="text-[#526A84]">Reference</div>
                  <div className="font-mono text-xs font-semibold text-[#0F2942]">
                    {confirmedInvoice.gatewayRef}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleProcessPaidCheckout} className="mt-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {plans.map((plan) => {
                  const selected = selectedPlanId === plan.id;
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedPlanId(plan.id)}
                      className={`text-left p-5 rounded-2xl border transition-all ${
                        selected
                          ? 'bg-[#EBF5FF] border-[#158EE3] ring-2 ring-[#158EE3]/20'
                          : 'bg-white border-[#DCEBFA] hover:border-[#99CAFA]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#158EE3]">
                          {plan.durationDays} Days
                        </span>
                        {plan.recommended && (
                          <span className="text-xs font-bold text-[#F96A1B]">Recommended</span>
                        )}
                      </div>
                      <div className="mt-1 text-lg font-display font-bold text-[#0F2942]">
                        {plan.name}
                      </div>
                      <div className="text-xs text-[#526A84]">{plan.nameSi}</div>
                      <div className="mt-3 text-2xl font-display font-extrabold text-[#0F2942] tabular-nums">
                        LKR {plan.priceLkr.toLocaleString('en-LK')}
                      </div>
                      <p className="mt-1 text-xs text-[#526A84]">{plan.audience}</p>
                      <ul className="mt-4 space-y-1.5 text-xs text-[#233B53]">
                        {plan.features.map((f) => (
                          <li key={f} className="flex items-start gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#4CAF50] shrink-0 mt-0.5" />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-4 border-t border-[#E5F0FA]">
                <div className="space-y-4">
                  <h3 className="text-base font-display font-bold text-[#0F2942]">
                    1. Select Secured Payment Gateway
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {(['PayHere LKR', 'Stripe Card'] as const).map((gw) => (
                      <button
                        key={gw}
                        type="button"
                        onClick={() => setGateway(gw)}
                        className={`p-3.5 rounded-xl border text-sm font-semibold flex items-center gap-2 ${
                          gateway === gw
                            ? 'bg-[#FFF5EE] border-[#F96A1B] text-[#0F2942]'
                            : 'bg-white border-[#DCEBFA] text-[#526A84]'
                        }`}
                      >
                        <CreditCard className="w-4 h-4 text-[#F96A1B]" />
                        <span>{gw}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-[#526A84]">
                    {mfaConfig.mfaRequired
                      ? 'Every payment creation requires dual verification (Email OTP + Google Authenticator TOTP) and generates an HMAC-SHA256 signed receipt emailed immediately.'
                      : 'Every payment generates an HMAC-SHA256 signed order and official HTML invoice emailed immediately (Email OTP & Google Authenticator temporarily disabled).'}
                  </p>
                </div>

                <div className="space-y-4 bg-[#F7FBFF] p-5 rounded-2xl border border-[#DCEBFA]">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-display font-bold text-[#0F2942]">
                      2. Confirm & Pay via {gateway}
                    </h3>
                    {mfaConfig.enableEmailOtp && (
                      <button
                        type="button"
                        onClick={handleRequestPaymentOtp}
                        disabled={busy}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-[#158EE3] rounded-lg hover:bg-[#1176BE] transition-colors whitespace-nowrap shrink-0"
                      >
                        Send Payment Email OTP
                      </button>
                    )}
                  </div>

                  {mfaConfig.mfaRequired && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {mfaConfig.enableEmailOtp && (
                        <div>
                          <label htmlFor="pay-email-otp" className="block text-xs font-semibold text-[#526A84] mb-1">
                            Email Verification Code
                          </label>
                          <input
                            id="pay-email-otp"
                            type="text"
                            inputMode="numeric"
                            placeholder="6-digit Email OTP"
                            value={paymentEmailOtp}
                            onChange={(e) => setPaymentEmailOtp(e.target.value)}
                            className="w-full px-3 py-2 text-sm font-mono bg-white border border-[#CBE2FA] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#158EE3]"
                            required
                          />
                        </div>
                      )}
                      {mfaConfig.enableTotp && (
                        <div>
                          <label htmlFor="pay-totp" className="block text-xs font-semibold text-[#526A84] mb-1">
                            Google Authenticator TOTP
                          </label>
                          <input
                            id="pay-totp"
                            type="text"
                            inputMode="numeric"
                            placeholder="6-digit TOTP"
                            value={paymentTotpCode}
                            onChange={(e) => setPaymentTotpCode(e.target.value)}
                            className="w-full px-3 py-2 text-sm font-mono bg-white border border-[#CBE2FA] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#158EE3]"
                            required
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {mfaConfig.enableTotp && demoHelper && (
                    <div className="p-3 rounded-xl bg-white border border-[#DCEBFA] text-xs flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-[#0F2942]">Authenticator Active Code</div>
                        <div className="text-[#526A84]">For {demoHelper.email}</div>
                      </div>
                      <div className="font-mono font-bold text-base text-[#158EE3] tabular-nums">
                        {demoHelper.currentCode}
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full py-2.5 px-4 text-sm font-bold text-white bg-[#4CAF50] hover:bg-[#3E9642] rounded-xl transition-colors disabled:opacity-60"
                  >
                    {busy ? 'Verifying & Confirming...' : 'Complete Signed Payment'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Live Email Inbox Drawer inside Billing */}
          {inboxEmails.length > 0 && (
            <div className="mt-6 pt-5 border-t border-[#E5F0FA]">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-display font-bold text-[#0F2942] flex items-center gap-2">
                  <Mail className="w-4 h-4 text-[#158EE3]" />
                  <span>Dispatched Security & Invoice Emails ({inboxEmails.length})</span>
                </h4>
                <button
                  type="button"
                  onClick={() => refreshSandboxInbox(existingUser.email)}
                  className="text-xs font-semibold text-[#158EE3] hover:underline"
                >
                  Refresh Inbox
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {inboxEmails.slice(0, 3).map((em) => (
                  <button
                    key={em.id}
                    type="button"
                    onClick={() => setSelectedEmailPreview(em)}
                    className={`p-3 rounded-xl border text-left text-xs ${
                      selectedEmailPreview?.id === em.id
                        ? 'bg-[#EBF5FF] border-[#158EE3]'
                        : 'bg-white border-[#DCEBFA]'
                    }`}
                  >
                    <div className="font-semibold text-[#0F2942] truncate">{em.subject}</div>
                    <div className="text-[#526A84] mt-0.5">
                      {em.otpCode ? `Code: ${em.otpCode}` : em.category}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#EAF5FF] flex flex-col justify-between py-6 px-4 sm:px-6">
      <div className="max-w-6xl w-full mx-auto">
        {/* Clean Brand Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <Man5heLogo size="md" />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setInboxOpen(!inboxOpen);
                refreshSandboxInbox();
              }}
              className="px-3.5 py-2 text-xs font-semibold text-[#0F2942] bg-white border border-[#CBE2FA] rounded-xl hover:bg-[#F7FBFF] transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Mail className="w-4 h-4 text-[#158EE3]" />
              <span>Verification Inbox ({inboxEmails.length})</span>
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left Hero Showcase matching uploaded reference */}
          <div className="lg:col-span-5 bg-white rounded-3xl border border-[#DCEBFA] p-7 flex flex-col justify-between">
            <div>
              <div className="bg-gradient-to-br from-[#DCEEFF] to-[#EBF5FF] rounded-2xl p-5 sm:p-6 border border-[#CBE2FA] flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-[#158EE3]">
                    Sri Lanka Grade 5 Scholarship
                  </div>
                  <h1 className="text-xl sm:text-2xl font-display font-extrabold text-[#0F2942] mt-1 leading-snug">
                    ආයුබෝවන්! මං 5හේ වෙත සාදරයෙන් පිළිගනිමු
                  </h1>
                  <p className="text-sm text-[#476481] mt-2 leading-relaxed">
                    500,000+ shuffled bilingual quizzes, child psychological memory tricks, timed mock papers & automated parent tracking.
                  </p>
                </div>
                <MascotAvatar className="w-20 h-20 shrink-0 hidden sm:block" />
              </div>

              {/* 4 Pillar Preview matching the 4 colors */}
              <div className="grid grid-cols-2 gap-3 mt-5">
                <div className="p-4 rounded-2xl bg-[#158EE3] text-white">
                  <div className="font-display font-bold text-sm">500,000+ Quizzes</div>
                  <div className="text-xs text-white/90 mt-0.5">Shuffled Practice Rounds</div>
                </div>
                <div className="p-4 rounded-2xl bg-[#F96A1B] text-white">
                  <div className="font-display font-bold text-sm">Timed Exam Hall</div>
                  <div className="text-xs text-white/90 mt-0.5">Simple to Master Levels</div>
                </div>
                <div className="p-4 rounded-2xl bg-[#F5A623] text-white">
                  <div className="font-display font-bold text-sm">Memory Psychology</div>
                  <div className="text-xs text-white/90 mt-0.5">Child Mnemonic Tricks</div>
                </div>
                <div className="p-4 rounded-2xl bg-[#4CAF50] text-white">
                  <div className="font-display font-bold text-sm">Parent Alerts</div>
                  <div className="text-xs text-white/90 mt-0.5">Email & WhatsApp Reports</div>
                </div>
              </div>
            </div>

            {/* Sandbox Demo Quick-Fill */}
            <div className="mt-6 pt-5 border-t border-[#E5F0FA] space-y-3">
              <div className="text-xs font-semibold text-[#526A84]">
                {mfaConfig.mfaRequired
                  ? 'Sandbox Demo Accounts (Enforces Full CAPTCHA + Email OTP + TOTP):'
                  : 'Demo Accounts (Password + SVG CAPTCHA + Robot Check · Authenticator Disabled):'}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-[#F3F9FF] border border-[#CBE2FA] space-y-1">
                  <div className="font-bold text-[#0F2942]">Student · Sayuri</div>
                  <div className="font-mono text-[10px] text-[#476481] truncate">
                    sayuri@man5he.lk
                  </div>
                  <div className="font-mono text-[10px] text-[#476481]">Sayuri@2026</div>
                  <button
                    type="button"
                    onClick={() => handleAutofillDemo('student')}
                    className="mt-1 w-full px-2.5 py-1.5 text-[11px] font-semibold text-white bg-[#158EE3] rounded-lg hover:bg-[#1176BE] transition-colors"
                  >
                    Fill Student
                  </button>
                </div>
                <div className="p-2.5 rounded-xl bg-[#F5F3FF] border border-[#DDD6FE] space-y-1">
                  <div className="font-bold text-[#0F2942]">Parent · Malini</div>
                  <div className="font-mono text-[10px] text-[#476481] truncate">
                    parent@man5he.lk
                  </div>
                  <div className="font-mono text-[10px] text-[#476481]">Parent@2026</div>
                  <button
                    type="button"
                    onClick={() => handleAutofillDemo('parent')}
                    className="mt-1 w-full px-2.5 py-1.5 text-[11px] font-semibold text-white bg-[#6D28D9] rounded-lg hover:bg-[#5B21B6] transition-colors"
                  >
                    Fill Parent
                  </button>
                </div>
                <div className="p-2.5 rounded-xl bg-[#EEF9EF] border border-[#B7E1BA] space-y-1">
                  <div className="font-bold text-[#0F2942]">Teacher · Nimali</div>
                  <div className="font-mono text-[10px] text-[#476481] truncate">
                    teacher.math@man5he.lk
                  </div>
                  <div className="font-mono text-[10px] text-[#476481]">Teacher@2026</div>
                  <button
                    type="button"
                    onClick={() => handleAutofillDemo('teacher')}
                    className="mt-1 w-full px-2.5 py-1.5 text-[11px] font-semibold text-white bg-[#2E7D32] rounded-lg hover:bg-[#236127] transition-colors"
                  >
                    Fill Teacher
                  </button>
                </div>
                <div className="p-2.5 rounded-xl bg-[#FFF5EE] border border-[#FAC5B2] space-y-1">
                  <div className="font-bold text-[#0F2942]">Admin · Studio</div>
                  <div className="font-mono text-[10px] text-[#476481] truncate">
                    admin@man5he.lk
                  </div>
                  <div className="font-mono text-[10px] text-[#476481]">Admin@2026</div>
                  <button
                    type="button"
                    onClick={() => handleAutofillDemo('admin')}
                    className="mt-1 w-full px-2.5 py-1.5 text-[11px] font-semibold text-white bg-[#F96A1B] rounded-lg hover:bg-[#DE580E] transition-colors"
                  >
                    Fill Admin
                  </button>
                </div>
              </div>
              {mfaConfig.enableTotp && demoHelper && (
                <div className="p-3 rounded-xl bg-[#F7FBFF] border border-[#DCEBFA] flex items-center gap-3">
                  <img
                    src={demoHelper.qrDataUrl}
                    alt="Demo Google Authenticator QR"
                    className="w-16 h-16 rounded-lg border border-[#DCEBFA] bg-white shrink-0"
                  />
                  <div className="text-xs flex-1">
                    <div className="font-semibold text-[#0F2942]">
                      Demo Authenticator ({demoHelper.userIdCode})
                    </div>
                    <div className="text-[#526A84] font-mono text-[11px] mt-0.5">
                      Secret: {demoHelper.totpSecret}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#158EE3]">
                        Live 30s Code:{' '}
                        <span className="font-mono text-sm font-bold">{demoHelper.currentCode}</span>
                      </span>
                      <span className="font-mono text-[11px] text-[#526A84] tabular-nums">
                        {totpSecondsRemaining}s
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Multi-Layer Security Form */}
          <div className="lg:col-span-7 bg-white rounded-3xl border border-[#DCEBFA] p-6 sm:p-8">
            <div className="flex items-center justify-between gap-4 pb-5 border-b border-[#E5F0FA]">
              <div className="flex items-center gap-1 p-1 bg-[#F3F9FF] rounded-xl border border-[#DCEBFA]">
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('login');
                    setErrorMsg(null);
                    setLoginChallengeId(null);
                  }}
                  className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    authTab === 'login'
                      ? 'bg-[#158EE3] text-white'
                      : 'text-[#526A84] hover:text-[#0F2942]'
                  }`}
                >
                  Secure Login
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('register');
                    setErrorMsg(null);
                    setRegStep2(null);
                  }}
                  className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    authTab === 'register'
                      ? 'bg-[#F96A1B] text-white'
                      : 'text-[#526A84] hover:text-[#0F2942]'
                  }`}
                >
                  Student Registration
                </button>
              </div>
              <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-[#526A84]">
                <ShieldCheck className="w-4 h-4 text-[#4CAF50]" />
                <span>
                  {mfaConfig.mfaRequired
                    ? 'CAPTCHA · Email OTP · Google TOTP'
                    : 'Password · SVG CAPTCHA · Robot Guard'}
                </span>
              </div>
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="mt-4 p-3.5 rounded-xl bg-[#FFF2ED] border border-[#FAC5B2] text-sm text-[#9A2F09] font-medium"
              >
                {errorMsg}
              </div>
            )}
            {infoMsg && (
              <div className="mt-4 p-3.5 rounded-xl bg-[#EBF5FF] border border-[#B9DCF9] text-sm text-[#0E4F80] font-medium">
                {infoMsg}
              </div>
            )}

            {/* LOGIN FORM */}
            {authTab === 'login' && !loginChallengeId && (
              <form onSubmit={handleLoginStep1} className="mt-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="login-id" className="block text-xs font-semibold text-[#476481] mb-1.5">
                      User ID or Email Address
                    </label>
                    <input
                      id="login-id"
                      type="text"
                      value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)}
                      placeholder="sayuri@man5he.lk or M5-2026-001"
                      className="w-full px-3.5 py-2.5 text-sm bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#158EE3]"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="login-pw" className="block text-xs font-semibold text-[#476481] mb-1.5">
                      Password
                    </label>
                    <input
                      id="login-pw"
                      type="password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Enter account password"
                      className="w-full px-3.5 py-2.5 text-sm bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#158EE3]"
                      required
                    />
                  </div>
                </div>

                {/* Honeypot hidden field */}
                <div className="hidden" aria-hidden="true">
                  <label htmlFor="hp-login">Leave blank</label>
                  <input
                    id="hp-login"
                    type="text"
                    tabIndex={-1}
                    value={honeypotValue}
                    onChange={(e) => setHoneypotValue(e.target.value)}
                  />
                </div>

                {/* SVG CAPTCHA + Robot Check */}
                <div className="p-4 rounded-2xl bg-[#F7FBFF] border border-[#DCEBFA] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="rounded-xl overflow-hidden"
                        dangerouslySetInnerHTML={{ __html: captchaSvg }}
                      />
                      <button
                        type="button"
                        onClick={loadCaptcha}
                        aria-label="Refresh CAPTCHA"
                        className="p-2.5 rounded-xl bg-white border border-[#CBE2FA] text-[#158EE3] hover:bg-[#EBF5FF]"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex-1 min-w-[160px]">
                      <label htmlFor="login-captcha" className="block text-xs font-semibold text-[#476481] mb-1">
                        CAPTCHA Answer
                      </label>
                      <input
                        id="login-captcha"
                        type="text"
                        inputMode="numeric"
                        value={captchaAnswer}
                        onChange={(e) => setCaptchaAnswer(e.target.value)}
                        placeholder="Type numeric result"
                        className="w-full px-3 py-2 text-sm font-mono bg-white border border-[#CBE2FA] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#158EE3]"
                        required
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none pt-1">
                    <input
                      type="checkbox"
                      checked={humanChecked}
                      onChange={(e) => setHumanChecked(e.target.checked)}
                      className="w-4 h-4 rounded accent-[#158EE3]"
                    />
                    <span className="text-sm font-medium text-[#0F2942]">
                      Robot Verification: I confirm I am a human student or parent
                    </span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={busy}
                    className="w-full py-3 px-5 text-sm font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <Lock className="w-4 h-4" />
                  <span>
                    {busy
                      ? 'Verifying Credentials...'
                      : mfaConfig.mfaRequired
                      ? 'Verify & Send Login Email Code'
                      : 'Verify CAPTCHA & Sign In'}
                  </span>
                </button>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('recover_pw');
                      setErrorMsg(null);
                      setInfoMsg(null);
                    }}
                    className="font-semibold text-[#158EE3] hover:underline"
                  >
                    Forgot Password? (Email / WhatsApp)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('recover_totp');
                      setErrorMsg(null);
                      setInfoMsg(null);
                    }}
                    className="font-semibold text-[#476481] hover:text-[#0F2942] hover:underline"
                  >
                    Lost Google Authenticator?
                  </button>
                </div>
              </form>
            )}

            {/* LOGIN STEP 2: Email OTP + Google Authenticator TOTP */}
            {authTab === 'login' && loginChallengeId && (
              <form onSubmit={handleLoginStep2} className="mt-5 space-y-4">
                <div className="p-4 rounded-2xl bg-[#F3F9FF] border border-[#CBE2FA] text-sm text-[#0F2942]">
                  Step 2 of 2:{' '}
                  {loginStep2Flags.requireEmailOtp && loginStep2Flags.requireTotp
                    ? 'Enter the 6-digit Email Login Code AND your 6-digit Google Authenticator (or backup) code.'
                    : loginStep2Flags.requireTotp
                    ? 'Enter your 6-digit Google Authenticator code (or a single-use M5RC- backup code).'
                    : 'Enter the 6-digit Email Login Code dispatched to your inbox.'}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {loginStep2Flags.requireEmailOtp && (
                    <div>
                      <label htmlFor="login-email-otp" className="block text-xs font-semibold text-[#476481] mb-1.5">
                        Email Verification Code
                      </label>
                      <input
                        id="login-email-otp"
                        type="text"
                        inputMode="numeric"
                        value={loginEmailOtp}
                        onChange={(e) => setLoginEmailOtp(e.target.value)}
                        placeholder="6-digit Email OTP"
                        className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-[#CBE2FA] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#158EE3]"
                        required
                      />
                    </div>
                  )}
                  {loginStep2Flags.requireTotp && (
                    <div>
                      <label htmlFor="login-totp" className="block text-xs font-semibold text-[#476481] mb-1.5">
                        Google Authenticator or Backup Code
                      </label>
                      <input
                        id="login-totp"
                        type="text"
                        value={loginTotpCode}
                        onChange={(e) => setLoginTotpCode(e.target.value)}
                        placeholder="6-digit TOTP or M5RC-XXXX-XXXX"
                        className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-[#CBE2FA] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#158EE3]"
                        required
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setLoginChallengeId(null)}
                    className="px-4 py-2.5 text-sm font-semibold text-[#526A84] bg-[#F3F9FF] rounded-xl border border-[#DCEBFA]"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex-1 py-2.5 px-5 text-sm font-bold text-white bg-[#4CAF50] hover:bg-[#3E9642] rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <KeyRound className="w-4 h-4" />
                    <span>{busy ? 'Authenticating...' : 'Complete Multi-Factor Sign In'}</span>
                  </button>
                </div>
              </form>
            )}

            {/* FORGOT PASSWORD RECOVERY (EMAIL OR WHATSAPP) */}
            {authTab === 'recover_pw' && (
              <div className="mt-5 space-y-4">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#E5F0FA]">
                  <div>
                    <h3 className="text-base font-display font-bold text-[#0F2942]">
                      Account Password Recovery
                    </h3>
                    <p className="text-xs text-[#526A84]">
                      Codes are dispatched exclusively to your verified registered Email or WhatsApp contact.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('login');
                      setRecChallengeId(null);
                      setRecResetToken(null);
                    }}
                    className="text-xs font-semibold text-[#158EE3] hover:underline"
                  >
                    Back to Login
                  </button>
                </div>

                {!recChallengeId && !recResetToken && (
                  <form onSubmit={handleRequestRecovery} className="space-y-3 text-xs">
                    <div>
                      <label htmlFor="rec-id" className="block font-semibold text-[#476481] mb-1">
                        Username, Student/Parent/Teacher ID, or Registered Email
                      </label>
                      <input
                        id="rec-id"
                        type="text"
                        value={recIdentifier}
                        onChange={(e) => setRecIdentifier(e.target.value)}
                        placeholder="e.g. sayuri@man5he.lk or M5-2026-001"
                        className="w-full px-3.5 py-2.5 text-sm bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => setRecChannel('email')}
                        className={`py-2.5 px-3 rounded-xl border font-bold ${
                          recChannel === 'email'
                            ? 'bg-[#EBF5FF] border-[#158EE3] text-[#158EE3]'
                            : 'bg-white border-[#DCEBFA] text-[#526A84]'
                        }`}
                      >
                        Verified Email OTP
                      </button>
                      <button
                        type="button"
                        onClick={() => setRecChannel('whatsapp')}
                        className={`py-2.5 px-3 rounded-xl border font-bold ${
                          recChannel === 'whatsapp'
                            ? 'bg-[#EEF9EF] border-[#2E7D32] text-[#1E6323]'
                            : 'bg-white border-[#DCEBFA] text-[#526A84]'
                        }`}
                      >
                        Verified WhatsApp OTP
                      </button>
                    </div>
                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full py-2.5 px-4 text-sm font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl"
                    >
                      {busy ? 'Dispatching Code...' : `Send ${recChannel === 'email' ? 'Email' : 'WhatsApp'} Recovery Code`}
                    </button>
                  </form>
                )}

                {recChallengeId && !recResetToken && (
                  <form onSubmit={handleVerifyRecoveryOtp} className="space-y-3 text-xs">
                    <div>
                      <label htmlFor="rec-otp" className="block font-semibold text-[#476481] mb-1">
                        6-Digit Verification Code (valid 5 minutes)
                      </label>
                      <input
                        id="rec-otp"
                        type="text"
                        inputMode="numeric"
                        value={recOtpCode}
                        onChange={(e) => setRecOtpCode(e.target.value)}
                        placeholder="Enter 6-digit code"
                        className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="rec-totp-opt" className="block font-semibold text-[#476481] mb-1">
                        Google Authenticator or Backup Code (if 2FA is active)
                      </label>
                      <input
                        id="rec-totp-opt"
                        type="text"
                        value={recTotpOrBackup}
                        onChange={(e) => setRecTotpOrBackup(e.target.value)}
                        placeholder="6-digit TOTP or M5RC-XXXX-XXXX (if enabled)"
                        className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full py-2.5 px-4 text-sm font-bold text-white bg-[#4CAF50] hover:bg-[#3E9642] rounded-xl"
                    >
                      {busy ? 'Verifying...' : 'Verify Recovery Code'}
                    </button>
                  </form>
                )}

                {recResetToken && (
                  <form onSubmit={handleCompleteRecoveryReset} className="space-y-3 text-xs">
                    {recRequiresTotp && (
                      <div>
                        <label htmlFor="rec-totp-req" className="block font-semibold text-[#476481] mb-1">
                          Google Authenticator or Backup Code (Required)
                        </label>
                        <input
                          id="rec-totp-req"
                          type="text"
                          value={recTotpOrBackup}
                          onChange={(e) => setRecTotpOrBackup(e.target.value)}
                          placeholder="6-digit TOTP or M5RC-XXXX-XXXX"
                          className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                          required
                        />
                      </div>
                    )}
                    <div>
                      <label htmlFor="rec-new-pw" className="block font-semibold text-[#476481] mb-1">
                        New Strong Password (8+ chars, upper, lower, digit, symbol)
                      </label>
                      <input
                        id="rec-new-pw"
                        type="password"
                        value={recNewPassword}
                        onChange={(e) => setRecNewPassword(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full py-2.5 px-4 text-sm font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl"
                    >
                      {busy ? 'Resetting Password...' : 'Reset Password & Sign Out Other Sessions'}
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* LOST AUTHENTICATOR RECOVERY */}
            {authTab === 'recover_totp' && (
              <div className="mt-5 space-y-4">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#E5F0FA]">
                  <div>
                    <h3 className="text-base font-display font-bold text-[#0F2942]">
                      Lost Google Authenticator Recovery
                    </h3>
                    <p className="text-xs text-[#526A84]">
                      Use a single-use backup code or submit an administrator-verified recovery request.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('login');
                      setAuthRecSetupQr(null);
                    }}
                    className="text-xs font-semibold text-[#158EE3] hover:underline"
                  >
                    Back to Login
                  </button>
                </div>

                {authRecSetupQr ? (
                  <div className="p-4 rounded-2xl bg-[#F7FBFF] border border-[#CBE2FA] flex flex-col sm:flex-row items-center gap-4 text-xs">
                    <img
                      src={authRecSetupQr.qrDataUrl}
                      alt="Fresh Authenticator QR"
                      className="w-32 h-32 rounded-xl border border-[#DCEBFA] bg-white shrink-0"
                    />
                    <div className="space-y-1.5">
                      <div className="font-bold text-[#0F2942]">Scan New Authenticator QR</div>
                      <p className="text-[#476481]">
                        Your old authenticator was disabled. Pair this QR key, then sign in and confirm under <strong>Account &amp; Security</strong>:
                      </p>
                      <div className="font-mono font-bold text-[#0F2942] bg-white px-2.5 py-1 rounded border border-[#DCEBFA]">
                        {authRecSetupQr.manualKey}
                      </div>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleRecoverAuthenticator} className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => setAuthRecMode('backup_code')}
                        className={`py-2 px-3 rounded-xl border font-bold ${
                          authRecMode === 'backup_code'
                            ? 'bg-[#EBF5FF] border-[#158EE3] text-[#158EE3]'
                            : 'bg-white border-[#DCEBFA] text-[#526A84]'
                        }`}
                      >
                        Use Backup Code
                      </button>
                      <button
                        type="button"
                        onClick={() => setAuthRecMode('admin_request')}
                        className={`py-2 px-3 rounded-xl border font-bold ${
                          authRecMode === 'admin_request'
                            ? 'bg-[#FFF5EE] border-[#F96A1B] text-[#9A2F09]'
                            : 'bg-white border-[#DCEBFA] text-[#526A84]'
                        }`}
                      >
                        Request Admin Reset
                      </button>
                    </div>
                    <input
                      type="text"
                      value={authRecIdentifier}
                      onChange={(e) => setAuthRecIdentifier(e.target.value)}
                      placeholder="Username, User ID, or Email"
                      className="w-full px-3.5 py-2.5 text-sm bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                      required
                    />
                    <input
                      type="password"
                      value={authRecPassword}
                      onChange={(e) => setAuthRecPassword(e.target.value)}
                      placeholder="Account password"
                      className="w-full px-3.5 py-2.5 text-sm bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                      required
                    />
                    {authRecMode === 'backup_code' ? (
                      <input
                        type="text"
                        value={authRecBackupCode}
                        onChange={(e) => setAuthRecBackupCode(e.target.value)}
                        placeholder="Single-use backup code (e.g. M5RC-XXXX-XXXX)"
                        className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                        required
                      />
                    ) : (
                      <input
                        type="text"
                        value={authRecReason}
                        onChange={(e) => setAuthRecReason(e.target.value)}
                        placeholder="Briefly describe your lost device for admin review"
                        className="w-full px-3.5 py-2.5 text-sm bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                        required
                      />
                    )}
                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full py-2.5 px-4 text-sm font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl"
                    >
                      {busy
                        ? 'Processing...'
                        : authRecMode === 'backup_code'
                        ? 'Reset Authenticator with Backup Code'
                        : 'Submit Request to Administrator'}
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* REGISTER STEP 1 */}
            {authTab === 'register' && !regStep2 && (
              <form onSubmit={handleRegisterInit} className="mt-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="reg-code" className="block text-xs font-semibold text-[#476481] mb-1">
                      Preferred Student User ID
                    </label>
                    <input
                      id="reg-code"
                      type="text"
                      value={regUserIdCode}
                      onChange={(e) => setRegUserIdCode(e.target.value)}
                      placeholder="M5-2026-108"
                      className="w-full px-3.5 py-2 text-sm font-mono bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="reg-name" className="block text-xs font-semibold text-[#476481] mb-1">
                      Student Full Name
                    </label>
                    <input
                      id="reg-name"
                      type="text"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      placeholder="e.g. Kasun Jayasinghe"
                      className="w-full px-3.5 py-2 text-sm bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="reg-email" className="block text-xs font-semibold text-[#476481] mb-1">
                      Parent / Student Email
                    </label>
                    <input
                      id="reg-email"
                      type="email"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="parent@example.lk"
                      className="w-full px-3.5 py-2 text-sm bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="reg-wa" className="block text-xs font-semibold text-[#476481] mb-1">
                      WhatsApp Number (Progress Reports)
                    </label>
                    <input
                      id="reg-wa"
                      type="text"
                      value={regWhatsapp}
                      onChange={(e) => setRegWhatsapp(e.target.value)}
                      placeholder="+94771234567"
                      className="w-full px-3.5 py-2 text-sm font-mono bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="reg-pw" className="block text-xs font-semibold text-[#476481] mb-1">
                    Strong Password (min 6 chars)
                  </label>
                  <input
                    id="reg-pw"
                    type="password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Create a secure password"
                    className="w-full px-3.5 py-2 text-sm bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                    required
                  />
                </div>

                {/* CAPTCHA + Robot Check */}
                <div className="p-4 rounded-2xl bg-[#F7FBFF] border border-[#DCEBFA] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="rounded-xl overflow-hidden"
                        dangerouslySetInnerHTML={{ __html: captchaSvg }}
                      />
                      <button
                        type="button"
                        onClick={loadCaptcha}
                        aria-label="Refresh Registration CAPTCHA"
                        className="p-2.5 rounded-xl bg-white border border-[#CBE2FA] text-[#158EE3]"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex-1 min-w-[160px]">
                      <label htmlFor="reg-captcha" className="block text-xs font-semibold text-[#476481] mb-1">
                        CAPTCHA Answer
                      </label>
                      <input
                        id="reg-captcha"
                        type="text"
                        inputMode="numeric"
                        value={captchaAnswer}
                        onChange={(e) => setCaptchaAnswer(e.target.value)}
                        placeholder="Numeric result"
                        className="w-full px-3 py-2 text-sm font-mono bg-white border border-[#CBE2FA] rounded-xl"
                        required
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={humanChecked}
                      onChange={(e) => setHumanChecked(e.target.checked)}
                      className="w-4 h-4 rounded accent-[#F96A1B]"
                    />
                    <span className="text-sm font-medium text-[#0F2942]">
                      Robot Verification: I am registering a genuine Grade 5 student account
                    </span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-3 px-5 text-sm font-bold text-white bg-[#F96A1B] hover:bg-[#DE580E] rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>
                    {busy
                      ? 'Creating Account...'
                      : mfaConfig.mfaRequired
                      ? 'Send Email Code & Setup Google Authenticator'
                      : 'Verify CAPTCHA & Create Account'}
                  </span>
                </button>
              </form>
            )}

            {/* REGISTER STEP 2: QR Code + Email OTP + TOTP */}
            {authTab === 'register' && regStep2 && (
              <form onSubmit={handleRegisterVerify} className="mt-5 space-y-4">
                <div className="p-4 rounded-2xl bg-[#F7FBFF] border border-[#CBE2FA] flex flex-col sm:flex-row items-center gap-4">
                  <img
                    src={regStep2.qrDataUrl}
                    alt="Scan with Google Authenticator"
                    className="w-32 h-32 rounded-xl border border-[#DCEBFA] bg-white shrink-0"
                  />
                  <div className="text-xs space-y-1.5">
                    <div className="text-sm font-display font-bold text-[#0F2942] flex items-center gap-1.5">
                      <Smartphone className="w-4 h-4 text-[#158EE3]" />
                      <span>Pair Google Authenticator</span>
                    </div>
                    <p className="text-[#476481]">
                      Scan this QR code in your Google Authenticator app (or enter the Base32 key manually):
                    </p>
                    <div className="font-mono font-bold text-[#0F2942] bg-white px-2.5 py-1.5 rounded-lg border border-[#DCEBFA] inline-block">
                      {regStep2.totpSecret}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="reg-email-otp" className="block text-xs font-semibold text-[#476481] mb-1">
                      Email Verification Code
                    </label>
                    <input
                      id="reg-email-otp"
                      type="text"
                      inputMode="numeric"
                      value={regEmailOtp}
                      onChange={(e) => setRegEmailOtp(e.target.value)}
                      placeholder="6-digit Email OTP"
                      className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-[#CBE2FA] rounded-xl"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="reg-totp" className="block text-xs font-semibold text-[#476481] mb-1">
                      Google Authenticator 6-Digit Code
                    </label>
                    <input
                      id="reg-totp"
                      type="text"
                      inputMode="numeric"
                      value={regTotpCode}
                      onChange={(e) => setRegTotpCode(e.target.value)}
                      placeholder="6-digit TOTP"
                      className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-[#CBE2FA] rounded-xl"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-3 px-5 text-sm font-bold text-white bg-[#4CAF50] hover:bg-[#3E9642] rounded-xl transition-colors"
                >
                  {busy ? 'Activating Account...' : 'Verify Both Codes & Enter මං 5හේ'}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Sandbox Email Inbox & Branded HTML Mail Viewer */}
        {inboxOpen && (
          <div className="mt-6 bg-white rounded-3xl border border-[#DCEBFA] p-6">
            <div className="flex items-center justify-between gap-4 pb-4 border-b border-[#E5F0FA]">
              <div className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-[#158EE3]" />
                <h3 className="text-base font-display font-bold text-[#0F2942]">
                  Dispatched Verification Email Viewer (Branded මං 5හේ HTML Mail)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInboxOpen(false)}
                className="text-xs font-semibold text-[#526A84] hover:text-[#0F2942]"
              >
                Close Inbox
              </button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mt-4">
              <div className="lg:col-span-4 space-y-2 max-h-80 overflow-y-auto">
                {inboxEmails.map((em) => (
                  <button
                    key={em.id}
                    type="button"
                    onClick={() => setSelectedEmailPreview(em)}
                    className={`w-full text-left p-3 rounded-xl border transition-colors ${
                      selectedEmailPreview?.id === em.id
                        ? 'bg-[#EBF5FF] border-[#158EE3]'
                        : 'bg-[#F8FBFF] border-[#DCEBFA] hover:bg-[#EFF7FF]'
                    }`}
                  >
                    <div className="text-xs font-bold text-[#0F2942] truncate">{em.subject}</div>
                    <div className="text-xs text-[#526A84] mt-0.5">To: {em.toEmail}</div>
                    {em.otpCode && (
                      <div className="mt-1 font-mono text-xs font-bold text-[#F96A1B]">
                        OTP Code: {em.otpCode}
                      </div>
                    )}
                  </button>
                ))}
              </div>
              <div className="lg:col-span-8">
                {selectedEmailPreview ? (
                  <iframe
                    title="Verification Email Preview"
                    srcDoc={selectedEmailPreview.htmlBody}
                    className="w-full h-80 rounded-2xl border border-[#DCEBFA] bg-[#EAF5FF]"
                  />
                ) : (
                  <div className="h-60 flex items-center justify-center text-sm text-[#526A84]">
                    Select an email to inspect the HTML template and verification code.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
