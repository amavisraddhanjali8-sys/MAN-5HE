import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  History,
  KeyRound,
  Laptop,
  Lock,
  Mail,
  MessageSquare,
  RefreshCw,
  Shield,
  ShieldCheck,
  Smartphone,
  UserCheck,
  X,
} from 'lucide-react';
import { api, AuthUser, type TotpEnrollmentSetup } from '../lib/api';
import type { AccountSecurityStatus, RecoveryChannel } from '../lib/types';

type SecurityTab = 'identity' | 'password' | 'authenticator' | 'sessions' | 'activity';

interface AccountSecurityModalProps {
  open: boolean;
  user: AuthUser;
  forceTotpOnboarding?: boolean;
  onClose: () => void;
  onUserUpdated: (user: AuthUser) => void;
}

export function AccountSecurityModal({
  open,
  user,
  forceTotpOnboarding = false,
  onClose,
  onUserUpdated,
}: AccountSecurityModalProps) {
  const [tab, setTab] = useState<SecurityTab>(
    forceTotpOnboarding ? 'authenticator' : 'identity'
  );
  const [status, setStatus] = useState<AccountSecurityStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Username change
  const [newUsername, setNewUsername] = useState(user.username || '');
  const [usernamePassword, setUsernamePassword] = useState('');
  const [usernameTotp, setUsernameTotp] = useState('');

  // Contact change
  const [contactEditChannel, setContactEditChannel] = useState<RecoveryChannel | null>(null);
  const [newContactVal, setNewContactVal] = useState('');
  const [contactPassword, setContactPassword] = useState('');
  const [contactTotp, setContactTotp] = useState('');
  const [lostOldContact, setLostOldContact] = useState(false);
  const [contactLossNotes, setContactLossNotes] = useState('');
  const [pendingContactReqId, setPendingContactReqId] = useState<string | null>(null);
  const [contactOtpCode, setContactOtpCode] = useState('');

  // Password change
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwTotp, setPwTotp] = useState('');
  const [revokeOthersOnPwChange, setRevokeOthersOnPwChange] = useState(true);

  // TOTP enrollment & backup codes
  const [totpSetup, setTotpSetup] = useState<TotpEnrollmentSetup | null>(null);
  const [totpVerifyCode, setTotpVerifyCode] = useState('');
  const [rotatePassword, setRotatePassword] = useState('');
  const [rotateCurrentTotp, setRotateCurrentTotp] = useState('');
  const [freshBackupCodes, setFreshBackupCodes] = useState<string[] | null>(null);
  const [regenPassword, setRegenPassword] = useState('');
  const [regenTotp, setRegenTotp] = useState('');

  // Guardian-assisted child TOTP recovery
  const [childTargetId, setChildTargetId] = useState('');
  const [guardianPassword, setGuardianPassword] = useState('');
  const [guardianTotp, setGuardianTotp] = useState('');

  const loadSecurityStatus = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.getAccountSecurityStatus();
      setStatus(data);
      setNewUsername(data.username);
      if (data.linkedChildren.length > 0 && !childTargetId) {
        setChildTargetId(data.linkedChildren[0].id);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setTab(forceTotpOnboarding ? 'authenticator' : 'identity');
    setErrorMsg(null);
    setInfoMsg(null);
    loadSecurityStatus();
  }, [open, forceTotpOnboarding, user.id]);

  if (!open) return null;

  const isAdmin = user.role === 'admin';
  const totpActive = status ? status.totp.status === 'ACTIVE' : user.totpEnabled;

  const pwChecks = {
    length: newPw.length >= 8,
    upper: /[A-Z]/.test(newPw),
    lower: /[a-z]/.test(newPw),
    digit: /\d/.test(newPw),
    symbol: /[^A-Za-z0-9]/.test(newPw),
  };

  const handleCopyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setInfoMsg(`${label} copied to clipboard.`);
    } catch {
      setErrorMsg('Clipboard unavailable. Please highlight and copy manually.');
    }
  };

  const handleDownloadBackupCodes = (codes: string[], labelUserId: string) => {
    const content = [
      'මං 5හේ (MAN 5HE) — Google Authenticator Backup Recovery Codes',
      `Account ID: ${labelUserId}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      'Each code can be used ONCE if you lose access to your authenticator device:',
      ...codes.map((c, idx) => `${idx + 1}. ${c}`),
      '',
      'Keep these codes offline in a safe place.',
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `man5he-backup-codes-${labelUserId.toLowerCase()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleUsernameUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const res = await api.changeUsername({
        newUsername,
        currentPassword: usernamePassword || undefined,
        totpCode: usernameTotp || undefined,
      });
      onUserUpdated(res.user);
      setUsernamePassword('');
      setUsernameTotp('');
      setInfoMsg(`Username updated to @${res.user.username}. All historical records remain linked.`);
      await loadSecurityStatus();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRequestContactChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactEditChannel) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const res = await api.requestContactChange({
        channel: contactEditChannel,
        newContact: newContactVal,
        currentPassword: contactPassword,
        totpCode: contactTotp || undefined,
        lostOldContact,
        verificationNotes: lostOldContact ? contactLossNotes : undefined,
      });
      if (res.escalatedToAdmin) {
        setContactEditChannel(null);
        setLostOldContact(false);
        setNewContactVal('');
        setContactPassword('');
        setContactTotp('');
        setContactLossNotes('');
        setInfoMsg(res.message);
        await loadSecurityStatus();
      } else {
        setPendingContactReqId(res.requestId);
        setInfoMsg(res.message);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmContactChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingContactReqId) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const res = await api.confirmContactChange({
        requestId: pendingContactReqId,
        otpCode: contactOtpCode,
      });
      onUserUpdated(res.user);
      setPendingContactReqId(null);
      setContactEditChannel(null);
      setContactOtpCode('');
      setNewContactVal('');
      setContactPassword('');
      setContactTotp('');
      setInfoMsg('Verified contact updated. A security alert has been sent to your previous and new contact.');
      await loadSecurityStatus();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    if (newPw !== confirmPw) {
      setErrorMsg('New password and confirmation do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.changePassword({
        currentPassword: currentPw,
        newPassword: newPw,
        totpCode: pwTotp || undefined,
        revokeOtherSessions: revokeOthersOnPwChange,
      });
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setPwTotp('');
      setInfoMsg(
        `Password updated successfully (${res.sessionsRevoked} other active session(s) signed out).`
      );
      await loadSecurityStatus();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleStartTotp = async (targetStudentId?: string) => {
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const setup = await api.startTotpEnrollment({
        targetStudentId,
        currentPassword: totpActive && !targetStudentId ? rotatePassword : undefined,
        currentTotpCode: totpActive && !targetStudentId ? rotateCurrentTotp : undefined,
      });
      setTotpSetup(setup);
      setFreshBackupCodes(null);
      setTotpVerifyCode('');
      setRotatePassword('');
      setRotateCurrentTotp('');
      setInfoMsg(
        setup.guardianAssisted
          ? `Scan the QR code for ${setup.targetUserName} in Google Authenticator and enter one 6-digit code to activate.`
          : 'Scan this QR code in Google Authenticator (or enter the Base32 key manually) and verify a 6-digit code.'
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpSetup) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const res = await api.confirmTotpEnrollment({
        code: totpVerifyCode,
        targetStudentId:
          totpSetup.targetUserId !== user.id ? totpSetup.targetUserId : undefined,
      });
      onUserUpdated(res.user);
      setFreshBackupCodes(res.backupCodes);
      setTotpSetup(null);
      setTotpVerifyCode('');
      setInfoMsg(
        'Google Authenticator is now active! Save your 8 single-use backup recovery codes below.'
      );
      await loadSecurityStatus();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerateBackupCodes = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const res = await api.regenerateBackupCodes({
        currentPassword: regenPassword,
        totpCode: regenTotp,
      });
      setFreshBackupCodes(res.backupCodes);
      setRegenPassword('');
      setRegenTotp('');
      setInfoMsg('8 fresh single-use backup codes generated. Previous unused codes are now void.');
      await loadSecurityStatus();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleGuardianRecoverChild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!childTargetId) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const res = await api.guardianRecoverChildTotp({
        studentId: childTargetId,
        parentPassword: guardianPassword,
        parentTotpCode: guardianTotp || undefined,
      });
      setTotpSetup(res.setup);
      setGuardianPassword('');
      setGuardianTotp('');
      setInfoMsg(
        `Child authenticator reset (${res.sessionsRevoked} session(s) signed out). Pair the new QR code and confirm a 6-digit code.`
      );
      await loadSecurityStatus();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    setErrorMsg(null);
    try {
      await api.revokeSession(sessionId);
      setInfoMsg('Session signed out.');
      await loadSecurityStatus();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleRevokeOthers = async () => {
    setErrorMsg(null);
    try {
      const res = await api.revokeOtherSessions();
      setInfoMsg(`Signed out ${res.revokedCount} other session(s).`);
      await loadSecurityStatus();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0F2942]/45 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Account & Security"
    >
      <div className="w-full max-w-4xl bg-white rounded-3xl border border-[#CBE2FA] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-[#F7FBFF] border-b border-[#DCEBFA] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[#158EE3] text-white flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-display font-extrabold text-[#0F2942] truncate">
                {forceTotpOnboarding && !totpActive
                  ? 'Mandatory Two-Factor Setup · Google Authenticator'
                  : 'Account & Security Settings'}
              </h2>
              <div className="text-xs text-[#526A84] truncate">
                {user.name} · <span className="font-mono">{user.userIdCode}</span> · @{status?.username || user.username || user.userIdCode.toLowerCase()}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Account and Security"
            className="p-2 rounded-xl text-[#526A84] hover:bg-[#E5F0FA] hover:text-[#0F2942]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 py-2.5 bg-white border-b border-[#E5F0FA] flex items-center gap-1.5 overflow-x-auto">
          {(
            [
              { id: 'identity', label: 'Username & Contacts', icon: <UserCheck className="w-3.5 h-3.5" /> },
              { id: 'password', label: 'Password', icon: <Lock className="w-3.5 h-3.5" /> },
              { id: 'authenticator', label: 'Google Authenticator', icon: <Smartphone className="w-3.5 h-3.5" /> },
              { id: 'sessions', label: 'Active Sessions', icon: <Laptop className="w-3.5 h-3.5" /> },
              { id: 'activity', label: 'Security Activity', icon: <History className="w-3.5 h-3.5" /> },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setErrorMsg(null);
                setInfoMsg(null);
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                tab === t.id
                  ? 'bg-[#158EE3] text-white'
                  : 'text-[#476481] hover:bg-[#F3F9FF]'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Alerts */}
        <div className="px-6 pt-3 space-y-2">
          {forceTotpOnboarding && !totpActive && !isAdmin && (
            <div className="p-3.5 rounded-2xl bg-[#FFF8EB] border border-[#F5A623] text-xs text-[#7B4B00] flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Google Authenticator Required for Non-Administrator Accounts</div>
                <div>
                  Verify one 6-digit authenticator code below to activate two-factor protection and generate your offline backup recovery codes.
                </div>
              </div>
            </div>
          )}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-[#FFF2ED] border border-[#FAC5B2] text-xs font-medium text-[#9A2F09]">
              {errorMsg}
            </div>
          )}
          {infoMsg && (
            <div className="p-3 rounded-xl bg-[#EEF9EF] border border-[#B7E1BA] text-xs font-medium text-[#1E6323]">
              {infoMsg}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {loading && !status ? (
            <div className="py-10 text-center text-sm text-[#526A84]">
              Loading security posture...
            </div>
          ) : (
            <>
              {/* TAB 1: USERNAME & VERIFIED CONTACTS */}
              {tab === 'identity' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Username Card */}
                  <div className="p-5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-4">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#E5F0FA]">
                      <div>
                        <h3 className="text-sm font-display font-bold text-[#0F2942]">
                          Sign-In Username &amp; Identity
                        </h3>
                        <p className="text-xs text-[#526A84]">
                          Internal Student/User ID ({user.userIdCode}) stays immutable across username updates.
                        </p>
                      </div>
                    </div>

                    {isAdmin ? (
                      <div className="p-3 rounded-xl bg-white border border-[#DCEBFA] text-xs text-[#476481]">
                        Administrator account identifiers are managed through separated protected governance and cannot be altered via self-service controls.
                      </div>
                    ) : (
                      <form onSubmit={handleUsernameUpdate} className="space-y-3 text-xs">
                        <div>
                          <label htmlFor="sec-username" className="block font-semibold text-[#476481] mb-1">
                            Username (4–30 chars: letters, numbers, . _ -)
                          </label>
                          <input
                            id="sec-username"
                            type="text"
                            value={newUsername}
                            onChange={(e) => setNewUsername(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-[#CBE2FA] rounded-xl font-mono text-sm"
                            required
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <div>
                            <label htmlFor="sec-un-pw" className="block font-semibold text-[#476481] mb-1">
                              Current Password
                            </label>
                            <input
                              id="sec-un-pw"
                              type="password"
                              value={usernamePassword}
                              onChange={(e) => setUsernamePassword(e.target.value)}
                              className="w-full px-3 py-2 bg-white border border-[#CBE2FA] rounded-xl text-sm"
                              required
                            />
                          </div>
                          {totpActive && (
                            <div>
                              <label htmlFor="sec-un-totp" className="block font-semibold text-[#476481] mb-1">
                                Authenticator Code
                              </label>
                              <input
                                id="sec-un-totp"
                                type="text"
                                inputMode="numeric"
                                value={usernameTotp}
                                onChange={(e) => setUsernameTotp(e.target.value)}
                                placeholder="6-digit TOTP"
                                className="w-full px-3 py-2 bg-white border border-[#CBE2FA] rounded-xl font-mono text-sm"
                                required
                              />
                            </div>
                          )}
                        </div>
                        <button
                          type="submit"
                          disabled={busy}
                          className="w-full py-2.5 px-4 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl"
                        >
                          {busy ? 'Updating...' : 'Save New Username'}
                        </button>
                      </form>
                    )}
                  </div>

                  {/* Verified Recovery Contacts */}
                  <div className="p-5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-4">
                    <div className="pb-2 border-b border-[#E5F0FA]">
                      <h3 className="text-sm font-display font-bold text-[#0F2942]">
                        Verified Email &amp; WhatsApp Contacts
                      </h3>
                      <p className="text-xs text-[#526A84]">
                        Recovery OTPs are sent strictly to your verified contact below after channel verification.
                      </p>
                    </div>

                    <div className="space-y-2.5 text-xs">
                      <div className="p-3 rounded-xl bg-white border border-[#DCEBFA] flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-[#0F2942] flex items-center gap-1.5">
                            <Mail className="w-3.5 h-3.5 text-[#158EE3]" />
                            <span className="truncate">{status?.email || user.email}</span>
                          </div>
                          <div className="text-[11px] text-[#2E7D32] mt-0.5 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>{user.emailVerified ? 'Verified Recovery Email' : 'Pending Verification'}</span>
                          </div>
                        </div>
                        {!isAdmin && (
                          <button
                            type="button"
                            onClick={() => {
                              setContactEditChannel('email');
                              setPendingContactReqId(null);
                              setLostOldContact(false);
                              setNewContactVal('');
                            }}
                            className="px-3 py-1.5 font-semibold text-[#158EE3] bg-[#EBF5FF] rounded-lg hover:bg-[#DCEEFF] shrink-0"
                          >
                            Change
                          </button>
                        )}
                      </div>

                      <div className="p-3 rounded-xl bg-white border border-[#DCEBFA] flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-[#0F2942] flex items-center gap-1.5">
                            <MessageSquare className="w-3.5 h-3.5 text-[#2E7D32]" />
                            <span className="font-mono truncate">{status?.whatsappNumber || user.whatsappNumber}</span>
                          </div>
                          <div className="text-[11px] text-[#2E7D32] mt-0.5 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>
                              {(status?.whatsappVerified ?? true)
                                ? 'Verified WhatsApp Recovery'
                                : 'Unverified'}
                            </span>
                          </div>
                        </div>
                        {!isAdmin && (
                          <button
                            type="button"
                            onClick={() => {
                              setContactEditChannel('whatsapp');
                              setPendingContactReqId(null);
                              setLostOldContact(false);
                              setNewContactVal('');
                            }}
                            className="px-3 py-1.5 font-semibold text-[#158EE3] bg-[#EBF5FF] rounded-lg hover:bg-[#DCEEFF] shrink-0"
                          >
                            Change
                          </button>
                        )}
                      </div>
                    </div>

                    {contactEditChannel && !pendingContactReqId && (
                      <form
                        onSubmit={handleRequestContactChange}
                        className="p-3.5 rounded-xl bg-white border border-[#99CAFA] space-y-2.5 text-xs"
                      >
                        <div className="font-bold text-[#0F2942]">
                          Update Verified {contactEditChannel === 'email' ? 'Email Address' : 'WhatsApp Number'}
                        </div>
                        <input
                          type={contactEditChannel === 'email' ? 'email' : 'text'}
                          value={newContactVal}
                          onChange={(e) => setNewContactVal(e.target.value)}
                          placeholder={contactEditChannel === 'email' ? 'new.email@example.lk' : '+94771234567'}
                          className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-sm"
                          required
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="password"
                            value={contactPassword}
                            onChange={(e) => setContactPassword(e.target.value)}
                            placeholder="Current password"
                            className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-sm"
                            required
                          />
                          {totpActive && (
                            <input
                              type="text"
                              inputMode="numeric"
                              value={contactTotp}
                              onChange={(e) => setContactTotp(e.target.value)}
                              placeholder="6-digit TOTP"
                              className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-mono text-sm"
                              required
                            />
                          )}
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer text-[#476481]">
                          <input
                            type="checkbox"
                            checked={lostOldContact}
                            onChange={(e) => setLostOldContact(e.target.checked)}
                            className="accent-[#F96A1B]"
                          />
                          <span>I lost access to my previous {contactEditChannel} (route to Administrator verification)</span>
                        </label>
                        {lostOldContact && (
                          <input
                            type="text"
                            value={contactLossNotes}
                            onChange={(e) => setContactLossNotes(e.target.value)}
                            placeholder="Brief note for administrator identity verification"
                            className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-xs"
                            required
                          />
                        )}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setContactEditChannel(null)}
                            className="px-3 py-2 rounded-lg bg-[#F3F9FF] text-[#526A84] font-semibold"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={busy}
                            className="flex-1 py-2 px-3 rounded-lg bg-[#158EE3] text-white font-bold"
                          >
                            {lostOldContact ? 'Submit Admin Recovery Request' : 'Send Code to New Contact'}
                          </button>
                        </div>
                      </form>
                    )}

                    {pendingContactReqId && (
                      <form
                        onSubmit={handleConfirmContactChange}
                        className="p-3.5 rounded-xl bg-white border border-[#4CAF50] space-y-2.5 text-xs"
                      >
                        <div className="font-bold text-[#1E6323]">
                          Confirm New {contactEditChannel === 'email' ? 'Email' : 'WhatsApp'}
                        </div>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={contactOtpCode}
                          onChange={(e) => setContactOtpCode(e.target.value)}
                          placeholder="Enter 6-digit verification code"
                          className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-mono text-sm"
                          required
                        />
                        <button
                          type="submit"
                          disabled={busy}
                          className="w-full py-2 px-3 rounded-lg bg-[#4CAF50] text-white font-bold"
                        >
                          Verify &amp; Replace Contact
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: PASSWORD */}
              {tab === 'password' && (
                <div className="max-w-xl mx-auto p-6 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-4">
                  <div>
                    <h3 className="text-base font-display font-bold text-[#0F2942]">
                      Update Account Password
                    </h3>
                    <p className="text-xs text-[#526A84]">
                      Last updated:{' '}
                      {status?.passwordUpdatedAt
                        ? new Date(status.passwordUpdatedAt).toLocaleString()
                        : 'Initial setup'}
                    </p>
                  </div>

                  <form onSubmit={handleChangePassword} className="space-y-3.5 text-xs">
                    <div>
                      <label htmlFor="pw-curr" className="block font-semibold text-[#476481] mb-1">
                        Current Password
                      </label>
                      <input
                        id="pw-curr"
                        type="password"
                        value={currentPw}
                        onChange={(e) => setCurrentPw(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white border border-[#CBE2FA] rounded-xl text-sm"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="pw-new" className="block font-semibold text-[#476481] mb-1">
                          New Password
                        </label>
                        <input
                          id="pw-new"
                          type="password"
                          value={newPw}
                          onChange={(e) => setNewPw(e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-white border border-[#CBE2FA] rounded-xl text-sm"
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="pw-conf" className="block font-semibold text-[#476481] mb-1">
                          Confirm New Password
                        </label>
                        <input
                          id="pw-conf"
                          type="password"
                          value={confirmPw}
                          onChange={(e) => setConfirmPw(e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-white border border-[#CBE2FA] rounded-xl text-sm"
                          required
                        />
                      </div>
                    </div>

                    {/* Strength policy checklist */}
                    <div className="p-3 rounded-xl bg-white border border-[#DCEBFA] grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px]">
                      {(
                        [
                          { ok: pwChecks.length, label: '8+ characters' },
                          { ok: pwChecks.upper, label: 'Uppercase letter' },
                          { ok: pwChecks.lower, label: 'Lowercase letter' },
                          { ok: pwChecks.digit, label: 'Number (0-9)' },
                          { ok: pwChecks.symbol, label: 'Special character' },
                        ] as const
                      ).map((c) => (
                        <div
                          key={c.label}
                          className={`flex items-center gap-1 ${
                            c.ok ? 'text-[#2E7D32] font-semibold' : 'text-[#64748B]'
                          }`}
                        >
                          <CheckCircle2 className="w-3 h-3 shrink-0" />
                          <span>{c.label}</span>
                        </div>
                      ))}
                    </div>

                    {totpActive && (
                      <div>
                        <label htmlFor="pw-totp" className="block font-semibold text-[#476481] mb-1">
                          Google Authenticator 6-Digit Code
                        </label>
                        <input
                          id="pw-totp"
                          type="text"
                          inputMode="numeric"
                          value={pwTotp}
                          onChange={(e) => setPwTotp(e.target.value)}
                          placeholder="6-digit TOTP"
                          className="w-full px-3.5 py-2.5 bg-white border border-[#CBE2FA] rounded-xl font-mono text-sm"
                          required
                        />
                      </div>
                    )}

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={revokeOthersOnPwChange}
                        onChange={(e) => setRevokeOthersOnPwChange(e.target.checked)}
                        className="accent-[#158EE3]"
                      />
                      <span className="text-[#0F2942] font-medium">
                        Revoke all other active sessions across devices
                      </span>
                    </label>

                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full py-2.5 px-4 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl"
                    >
                      {busy ? 'Updating Password...' : 'Save New Password'}
                    </button>
                  </form>
                </div>
              )}

              {/* TAB 3: GOOGLE AUTHENTICATOR & GUARDIAN ASSISTANCE */}
              {tab === 'authenticator' && (
                <div className="space-y-5">
                  {isAdmin ? (
                    <div className="p-6 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] flex items-start gap-3">
                      <Shield className="w-5 h-5 text-[#F96A1B] shrink-0 mt-0.5" />
                      <div className="space-y-1 text-xs">
                        <div className="text-sm font-display font-bold text-[#0F2942]">
                          Administrator Security Separation Active
                        </div>
                        <p className="text-[#476481] leading-relaxed">
                          Per platform security architecture, administrator accounts are excluded from non-admin self-service TOTP enrollment and recovery endpoints. Manage user recovery requests under <strong>Teachers &amp; Students → Account Recovery Queue</strong>.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                        {/* Status & Enrollment Control */}
                        <div className="lg:col-span-6 p-5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-4">
                          <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#E5F0FA]">
                            <div>
                              <h3 className="text-sm font-display font-bold text-[#0F2942]">
                                Google Authenticator (TOTP)
                              </h3>
                              <div className="text-xs text-[#526A84]">
                                Status:{' '}
                                <span
                                  className={`font-bold ${
                                    totpActive ? 'text-[#2E7D32]' : 'text-[#D97706]'
                                  }`}
                                >
                                  {totpActive ? 'ACTIVE & PROTECTED' : 'ENROLLMENT REQUIRED'}
                                </span>
                              </div>
                            </div>
                            <div className="text-right text-xs tabular-nums">
                              <div className="font-bold text-[#0F2942]">
                                {status?.totp.backupCodesRemaining ?? 0}
                              </div>
                              <div className="text-[11px] text-[#526A84]">Backup codes left</div>
                            </div>
                          </div>

                          {!totpSetup && !totpActive && (
                            <div className="space-y-3 text-xs">
                              <p className="text-[#476481]">
                                Generate a QR setup key to pair Google Authenticator on your phone (or a linked guardian&apos;s phone).
                              </p>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleStartTotp()}
                                className="w-full py-2.5 px-4 text-xs font-bold text-white bg-[#F96A1B] hover:bg-[#DE580E] rounded-xl flex items-center justify-center gap-2"
                              >
                                <Smartphone className="w-4 h-4" />
                                <span>Generate Google Authenticator QR Code</span>
                              </button>
                            </div>
                          )}

                          {!totpSetup && totpActive && (
                            <div className="space-y-4 text-xs">
                              <div className="p-3 rounded-xl bg-[#EEF9EF] border border-[#B7E1BA] text-[#1E6323]">
                                Authenticator active since{' '}
                                {status?.totp.verifiedAt
                                  ? new Date(status.totp.verifiedAt).toLocaleString()
                                  : 'enrollment'}
                                {status?.totp.guardianAssisted ? ' (Guardian-assisted)' : ''}.
                              </div>

                              <div className="p-3.5 rounded-xl bg-white border border-[#DCEBFA] space-y-2.5">
                                <div className="font-bold text-[#0F2942]">
                                  Switch / Re-pair Authenticator Device
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <input
                                    type="password"
                                    value={rotatePassword}
                                    onChange={(e) => setRotatePassword(e.target.value)}
                                    placeholder="Current password"
                                    className="px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-xs"
                                  />
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={rotateCurrentTotp}
                                    onChange={(e) => setRotateCurrentTotp(e.target.value)}
                                    placeholder="Current 6-digit TOTP"
                                    className="px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-mono text-xs"
                                  />
                                </div>
                                <button
                                  type="button"
                                  disabled={busy || !rotatePassword || !rotateCurrentTotp}
                                  onClick={() => handleStartTotp()}
                                  className="w-full py-2 px-3 bg-[#158EE3] disabled:opacity-50 text-white font-bold rounded-xl"
                                >
                                  Start Device Rotation
                                </button>
                              </div>

                              <form
                                onSubmit={handleRegenerateBackupCodes}
                                className="p-3.5 rounded-xl bg-white border border-[#DCEBFA] space-y-2.5"
                              >
                                <div className="font-bold text-[#0F2942]">
                                  Regenerate 8 Single-Use Backup Codes
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <input
                                    type="password"
                                    value={regenPassword}
                                    onChange={(e) => setRegenPassword(e.target.value)}
                                    placeholder="Current password"
                                    className="px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-xs"
                                    required
                                  />
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={regenTotp}
                                    onChange={(e) => setRegenTotp(e.target.value)}
                                    placeholder="6-digit TOTP"
                                    className="px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-mono text-xs"
                                    required
                                  />
                                </div>
                                <button
                                  type="submit"
                                  disabled={busy}
                                  className="w-full py-2 px-3 bg-[#0F2942] text-white font-bold rounded-xl flex items-center justify-center gap-1.5"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                  <span>Generate Fresh Backup Codes</span>
                                </button>
                              </form>
                            </div>
                          )}

                          {totpSetup && (
                            <form onSubmit={handleConfirmTotp} className="space-y-3 text-xs">
                              <div className="p-4 rounded-2xl bg-white border border-[#CBE2FA] flex flex-col sm:flex-row items-center gap-4">
                                <img
                                  src={totpSetup.qrDataUrl}
                                  alt="Google Authenticator Setup QR"
                                  className="w-36 h-36 rounded-xl border border-[#DCEBFA] bg-white shrink-0"
                                />
                                <div className="space-y-2 min-w-0 flex-1">
                                  <div className="font-bold text-[#0F2942]">
                                    Pair {totpSetup.targetUserName}
                                  </div>
                                  <p className="text-[#476481]">
                                    Scan in Google Authenticator or copy the manual Base32 setup key:
                                  </p>
                                  <div className="flex items-center gap-2">
                                    <code className="px-2.5 py-1.5 bg-[#F8FBFF] border border-[#DCEBFA] rounded-lg font-mono font-bold text-[#0F2942] break-all">
                                      {totpSetup.manualKey}
                                    </code>
                                    <button
                                      type="button"
                                      onClick={() => handleCopyText(totpSetup.manualKey, 'Setup key')}
                                      className="p-1.5 rounded-lg bg-[#EBF5FF] text-[#158EE3] shrink-0"
                                      aria-label="Copy manual key"
                                    >
                                      <Copy className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              </div>

                              <div>
                                <label htmlFor="totp-confirm-input" className="block font-semibold text-[#476481] mb-1">
                                  Enter 6-Digit Code from Authenticator to Activate
                                </label>
                                <input
                                  id="totp-confirm-input"
                                  type="text"
                                  inputMode="numeric"
                                  value={totpVerifyCode}
                                  onChange={(e) => setTotpVerifyCode(e.target.value)}
                                  placeholder="6-digit code"
                                  className="w-full px-3.5 py-2.5 bg-white border border-[#CBE2FA] rounded-xl font-mono text-sm"
                                  required
                                />
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setTotpSetup(null)}
                                  className="px-3.5 py-2.5 rounded-xl bg-white border border-[#CBE2FA] text-[#526A84] font-semibold"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="submit"
                                  disabled={busy}
                                  className="flex-1 py-2.5 px-4 rounded-xl bg-[#4CAF50] hover:bg-[#3E9642] text-white font-bold"
                                >
                                  {busy ? 'Activating...' : 'Verify Code & Activate 2FA'}
                                </button>
                              </div>
                            </form>
                          )}
                        </div>

                        {/* Right Column: Backup Codes Display OR Guardian Assistance */}
                        <div className="lg:col-span-6 space-y-4">
                          {freshBackupCodes ? (
                            <div className="p-5 rounded-2xl bg-[#FFF8EB] border border-[#F5A623] space-y-3 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <div className="font-display font-bold text-sm text-[#0F2942] flex items-center gap-1.5">
                                  <KeyRound className="w-4 h-4 text-[#D97706]" />
                                  <span>Save Your One-Time Backup Codes</span>
                                </div>
                              </div>
                              <p className="text-[#7B4B00]">
                                These 8 codes are shown only once. Store them offline to regain access if your phone is lost.
                              </p>
                              <div className="grid grid-cols-2 gap-2">
                                {freshBackupCodes.map((code) => (
                                  <div
                                    key={code}
                                    className="px-3 py-2 bg-white border border-[#F3D19C] rounded-xl font-mono font-bold text-[#0F2942] text-center"
                                  >
                                    {code}
                                  </div>
                                ))}
                              </div>
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleCopyText(freshBackupCodes.join('\n'), 'Backup codes')
                                  }
                                  className="flex-1 py-2 px-3 rounded-xl bg-white border border-[#F3D19C] text-[#0F2942] font-bold flex items-center justify-center gap-1.5"
                                >
                                  <Copy className="w-3.5 h-3.5" /> Copy All
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDownloadBackupCodes(freshBackupCodes, user.userIdCode)
                                  }
                                  className="flex-1 py-2 px-3 rounded-xl bg-[#0F2942] text-white font-bold flex items-center justify-center gap-1.5"
                                >
                                  <Download className="w-3.5 h-3.5" /> Download .txt
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="p-5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2 text-xs">
                              <div className="font-display font-bold text-sm text-[#0F2942]">
                                Offline Recovery Readiness
                              </div>
                              <p className="text-[#476481] leading-relaxed">
                                Backup codes allow one-time entry if you change phones or lose access to Google Authenticator. Never share your setup key or backup codes with anyone.
                              </p>
                              {status?.linkedGuardian && (
                                <div className="p-3 rounded-xl bg-white border border-[#DCEBFA] text-[#0F2942]">
                                  <strong>Linked Guardian:</strong> {status.linkedGuardian.name} ({status.linkedGuardian.email} · {status.linkedGuardian.whatsappNumber}) can assist with Grade 5 authenticator enrollment and recovery.
                                </div>
                              )}
                            </div>
                          )}

                          {/* Guardian-Assisted Child Authenticator Panel */}
                          {user.role === 'parent' && status && status.linkedChildren.length > 0 && (
                            <form
                              onSubmit={handleGuardianRecoverChild}
                              className="p-5 rounded-2xl bg-[#EEF9EF] border border-[#B7E1BA] space-y-3 text-xs"
                            >
                              <div className="font-display font-bold text-sm text-[#1E6323]">
                                Guardian-Assisted Child Authenticator Control
                              </div>
                              <p className="text-[#2E6B34]">
                                Enroll or reset Google Authenticator for your linked Grade 5 student account.
                              </p>
                              <select
                                value={childTargetId}
                                onChange={(e) => setChildTargetId(e.target.value)}
                                className="w-full px-3 py-2 bg-white border border-[#B7E1BA] rounded-xl text-sm font-semibold"
                              >
                                {status.linkedChildren.map((ch) => (
                                  <option key={ch.id} value={ch.id}>
                                    {ch.name} ({ch.userIdCode}) · {ch.totpEnabled ? '2FA Active' : 'Needs Setup'}
                                  </option>
                                ))}
                              </select>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <input
                                  type="password"
                                  value={guardianPassword}
                                  onChange={(e) => setGuardianPassword(e.target.value)}
                                  placeholder="Guardian password"
                                  className="px-3 py-2 bg-white border border-[#B7E1BA] rounded-xl text-xs"
                                  required
                                />
                                {totpActive && (
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={guardianTotp}
                                    onChange={(e) => setGuardianTotp(e.target.value)}
                                    placeholder="Guardian 6-digit TOTP"
                                    className="px-3 py-2 bg-white border border-[#B7E1BA] rounded-xl font-mono text-xs"
                                    required
                                  />
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleStartTotp(childTargetId)}
                                  className="flex-1 py-2 px-3 rounded-xl bg-[#2E7D32] text-white font-bold"
                                >
                                  Pair Child Authenticator
                                </button>
                                <button
                                  type="submit"
                                  disabled={busy}
                                  className="flex-1 py-2 px-3 rounded-xl bg-white border border-[#2E7D32] text-[#1E6323] font-bold"
                                >
                                  Reset Child Lost Device
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* TAB 4: ACTIVE SESSIONS */}
              {tab === 'sessions' && status && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-display font-bold text-[#0F2942]">
                        Signed-In Devices &amp; Active Sessions
                      </h3>
                      <p className="text-xs text-[#526A84]">
                        Revoke unfamiliar devices immediately or sign out everywhere else.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRevokeOthers}
                      className="px-3.5 py-2 text-xs font-bold text-[#9A2F09] bg-[#FFF2ED] border border-[#FAC5B2] rounded-xl hover:bg-[#FFE4DA]"
                    >
                      Sign Out Other Devices
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {status.activeSessions.map((ses) => {
                      const revoked = Boolean(ses.revokedAt);
                      return (
                        <div
                          key={ses.id}
                          className={`p-3.5 rounded-2xl border text-xs flex flex-wrap items-center justify-between gap-3 ${
                            revoked
                              ? 'bg-[#F8FAFC] border-[#E2E8F0] opacity-70'
                              : ses.isCurrent
                              ? 'bg-[#EBF5FF] border-[#99CAFA]'
                              : 'bg-white border-[#DCEBFA]'
                          }`}
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="font-bold text-[#0F2942] flex items-center gap-2">
                              <span>{ses.deviceLabel}</span>
                              {ses.isCurrent && !revoked && (
                                <span className="text-[10px] font-bold text-[#158EE3]">
                                  · THIS DEVICE
                                </span>
                              )}
                              {revoked && (
                                <span className="text-[10px] font-bold text-[#9A2F09]">
                                  · REVOKED ({ses.revokeReason})
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#526A84] font-mono">
                              IP: {ses.ipAddress} · Last seen: {new Date(ses.lastSeenAt).toLocaleString()}
                            </div>
                          </div>
                          {!revoked && !ses.isCurrent && (
                            <button
                              type="button"
                              onClick={() => handleRevokeSession(ses.id)}
                              className="px-3 py-1.5 text-xs font-bold text-[#9A2F09] bg-[#FFF2ED] border border-[#FAC5B2] rounded-lg"
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 5: SECURITY EVENTS & ADMIN REQUEST HISTORY */}
              {tab === 'activity' && status && (
                <div className="space-y-5">
                  {status.pendingRecoveryRequests.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-display font-bold text-[#0F2942]">
                        Administrator Recovery Requests ({status.pendingRecoveryRequests.length})
                      </h3>
                      {status.pendingRecoveryRequests.map((req) => (
                        <div
                          key={req.id}
                          className="p-3 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA] text-xs flex items-center justify-between gap-3"
                        >
                          <div>
                            <div className="font-bold text-[#0F2942]">
                              {req.requestType.replace(/_/g, ' ').toUpperCase()} · {req.id}
                            </div>
                            <div className="text-[#526A84] mt-0.5">{req.verificationNotes}</div>
                          </div>
                          <span className="font-bold text-[#158EE3] shrink-0">{req.status}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2">
                    <h3 className="text-sm font-display font-bold text-[#0F2942]">
                      Recent Security Activity ({status.recentSecurityEvents.length})
                    </h3>
                    {status.recentSecurityEvents.map((ev) => (
                      <div
                        key={ev.id}
                        className="p-3 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA] text-xs flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-[#0F2942]">
                            {ev.eventType}{' '}
                            {ev.channel && (
                              <span className="font-mono text-[#158EE3]">({ev.channel})</span>
                            )}
                          </div>
                          <div className="text-[#476481] mt-0.5">{ev.summary}</div>
                        </div>
                        <span className="text-[11px] text-[#64748B] shrink-0 tabular-nums">
                          {new Date(ev.createdAt).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
