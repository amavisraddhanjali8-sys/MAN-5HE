import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import { api, AuthUser } from '../lib/api';
import type { NotificationPreferences, NotificationRecord, SubjectCategory } from '../lib/types';

interface ProfileAlertsMenuProps {
  user: AuthUser;
  subjects: SubjectCategory[];
  onUserUpdated: (user: AuthUser) => void;
  onSignOut: () => void;
  onOpenSecurity?: () => void;
  onOpenCase?: (caseId: string) => void;
  onOpenPublication?: (publicationId: string) => void;
}

export function ProfileAlertsMenu({
  user,
  subjects,
  onUserUpdated,
  onSignOut,
  onOpenSecurity,
  onOpenCase,
  onOpenPublication,
}: ProfileAlertsMenuProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'alerts' | 'settings'>('alerts');
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [prefs, setPrefs] = useState<NotificationPreferences>(
    user.notificationPreferences || {
      inApp: true,
      email: true,
      whatsapp: true,
      groupedSummary: false,
    }
  );
  const [guardianName, setGuardianName] = useState(user.guardianName || '');
  const [guardianVerified, setGuardianVerified] = useState(user.guardianContactVerified ?? true);
  const [guardianConsent, setGuardianConsent] = useState(user.guardianConsentGiven ?? true);
  const [savingMsg, setSavingMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const loadNotifications = async () => {
    try {
      const res = await api.getNotifications();
      setNotifications(res.notifications);
      setUnreadCount(res.unreadCount);
    } catch {
      // ignore background poll errors
    }
  };

  useEffect(() => {
    loadNotifications();
  }, [user.id]);

  const handleMarkRead = async (id: string) => {
    await api.markNotificationRead(id);
    await loadNotifications();
  };

  const handleRetry = async (id: string) => {
    setErrMsg(null);
    try {
      await api.retryNotification(id);
      await loadNotifications();
    } catch (err) {
      setErrMsg((err as Error).message);
    }
  };

  const handleSavePreferences = async (next: NotificationPreferences) => {
    setPrefs(next);
    setSavingMsg(null);
    try {
      const res = await api.updateNotificationPreferences(next);
      setPrefs(res.preferences);
      setSavingMsg('Preferences saved.');
    } catch (err) {
      setErrMsg((err as Error).message);
    }
  };

  const handleSaveGuardian = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMsg(null);
    setErrMsg(null);
    try {
      const res = await api.updateStudentGuardian(user.id, {
        guardianName,
        guardianContactVerified: guardianVerified,
        guardianConsentGiven: guardianConsent,
      });
      onUserUpdated(res.user);
      setSavingMsg('Guardian contact & consent updated.');
    } catch (err) {
      setErrMsg((err as Error).message);
    }
  };

  const subjectMap = new Map(subjects.map((s) => [s.id, s.nameEn]));
  const assignedSubjectLabels = (user.assignedSubjectIds || []).map(
    (id) => subjectMap.get(id) || id
  );

  return (
    <div className="relative flex items-center gap-2 shrink-0">
      {onOpenSecurity && (
        <button
          type="button"
          data-testid="account-security-trigger"
          onClick={() => {
            setOpen(false);
            onOpenSecurity();
          }}
          className="px-3 py-2 text-xs font-bold text-[#0F2942] bg-[#F3F9FF] border border-[#CBE2FA] rounded-xl hover:bg-[#E2F0FD] transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <ShieldCheck
            className={`w-3.5 h-3.5 ${
              user.role !== 'admin' && !user.totpEnabled ? 'text-[#F96A1B]' : 'text-[#2E7D32]'
            }`}
          />
          <span className="hidden sm:inline">Security</span>
        </button>
      )}

      <button
        type="button"
        data-testid="profile-alerts-trigger"
        onClick={() => {
          setOpen((v) => !v);
          loadNotifications();
        }}
        className="px-3.5 py-2 text-xs font-bold text-[#0F2942] bg-[#F3F9FF] border border-[#CBE2FA] rounded-xl hover:bg-[#E2F0FD] transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
      >
        <Bell className="w-3.5 h-3.5 text-[#158EE3]" />
        <span>Alerts & Profile</span>
        {unreadCount > 0 && (
          <span
            data-testid="unread-alerts-count"
            className="px-1.5 py-0.5 text-[10px] font-extrabold bg-[#F96A1B] text-white rounded-md tabular-nums"
          >
            {unreadCount}
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={onSignOut}
        className="px-3.5 py-2 text-xs font-bold text-[#0F2942] bg-[#F3F9FF] border border-[#CBE2FA] rounded-xl hover:bg-[#E2F0FD] transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
      >
        <LogOut className="w-3.5 h-3.5" />
        <span>Sign Out</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Profile, Guardian Consent and Alerts"
          className="fixed inset-x-3 top-20 sm:absolute sm:inset-auto sm:right-0 sm:top-12 sm:w-[440px] bg-white rounded-3xl border border-[#CBE2FA] shadow-xl z-50 overflow-hidden"
        >
          <div className="p-4 bg-[#F7FBFF] border-b border-[#E5F0FA] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#158EE3] text-white flex items-center justify-center shrink-0">
                <User className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-display font-bold text-[#0F2942] truncate">
                  {user.name}
                </div>
                <div className="text-[11px] font-mono text-[#526A84] truncate">
                  {user.userIdCode} · {user.role.toUpperCase()}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {onOpenSecurity && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpenSecurity();
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-[#EBF5FF] text-[#158EE3] text-[11px] font-bold hover:bg-[#DCEEFF]"
                >
                  Account &amp; Security
                </button>
              )}
              <button
                type="button"
                aria-label="Close profile menu"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-[#526A84] hover:bg-[#E5F0FA]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {user.role === 'teacher' && (
            <div className="px-4 py-2.5 bg-[#EEF9EF] border-b border-[#D5EDD8] text-xs text-[#1E6323]">
              <strong>Assigned Subjects ({assignedSubjectLabels.length}):</strong>{' '}
              {assignedSubjectLabels.length > 0
                ? assignedSubjectLabels.join(', ')
                : 'No subjects assigned yet'}
            </div>
          )}

          <div className="p-3 border-b border-[#E5F0FA] flex items-center gap-1 bg-white">
            <button
              type="button"
              onClick={() => setTab('alerts')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg ${
                tab === 'alerts' ? 'bg-[#158EE3] text-white' : 'text-[#526A84] hover:bg-[#F3F9FF]'
              }`}
            >
              Notifications ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('settings')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg ${
                tab === 'settings' ? 'bg-[#158EE3] text-white' : 'text-[#526A84] hover:bg-[#F3F9FF]'
              }`}
            >
              Preferences & Consent
            </button>
          </div>

          {errMsg && (
            <div className="mx-4 mt-3 p-2.5 rounded-xl bg-[#FFF2ED] border border-[#FAC5B2] text-xs text-[#9A2F09]">
              {errMsg}
            </div>
          )}
          {savingMsg && (
            <div className="mx-4 mt-3 p-2.5 rounded-xl bg-[#EEF9EF] border border-[#B7E1BA] text-xs text-[#1E6323]">
              {savingMsg}
            </div>
          )}

          {tab === 'alerts' ? (
            <div className="p-4 space-y-2.5 max-h-[380px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="py-8 text-center text-xs text-[#526A84]">
                  No notifications recorded yet.
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-3 rounded-2xl border text-xs space-y-1.5 ${
                      n.deliveryStatus === 'failed' || n.deliveryStatus === 'skipped_unverified'
                        ? 'bg-[#FFF5EE] border-[#FAC5B2]'
                        : n.readAt
                        ? 'bg-[#F8FBFF] border-[#E5F0FA]'
                        : 'bg-[#EBF5FF] border-[#B9DCF9]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-bold text-[#0F2942]">{n.title}</div>
                      <span className="text-[10px] font-semibold uppercase text-[#526A84] shrink-0">
                        {n.channel.replace('_', '-')}
                      </span>
                    </div>
                    <p className="text-[#476481] leading-relaxed">{n.body}</p>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="text-[10px] text-[#526A84] flex items-center gap-1">
                        {n.deliveryStatus === 'delivered' ? (
                          <CheckCircle2 className="w-3 h-3 text-[#2E7D32]" />
                        ) : (
                          <AlertTriangle className="w-3 h-3 text-[#C62828]" />
                        )}
                        <span>
                          {n.deliveryStatus} · {new Date(n.createdAt).toLocaleString()}
                        </span>
                      </span>
                      <div className="flex items-center gap-2">
                        {n.relatedPublicationId && onOpenPublication && (
                          <button
                            type="button"
                            onClick={() => {
                              setOpen(false);
                              onOpenPublication(n.relatedPublicationId!);
                            }}
                            className="text-[11px] font-bold text-[#2E7D32] hover:underline"
                          >
                            Open Guide
                          </button>
                        )}
                        {n.relatedCaseId && onOpenCase && (
                          <button
                            type="button"
                            onClick={() => {
                              setOpen(false);
                              onOpenCase(n.relatedCaseId!);
                            }}
                            className="text-[11px] font-bold text-[#158EE3] hover:underline"
                          >
                            Open Case
                          </button>
                        )}
                        {(n.deliveryStatus === 'failed' || n.deliveryStatus === 'skipped_unverified') &&
                          (user.role === 'admin' || user.role === 'teacher') && (
                            <button
                              type="button"
                              onClick={() => handleRetry(n.id)}
                              className="text-[11px] font-bold text-[#F96A1B] flex items-center gap-0.5 hover:underline"
                            >
                              <RefreshCw className="w-3 h-3" /> Retry
                            </button>
                          )}
                        {!n.readAt && n.recipientUserId === user.id && (
                          <button
                            type="button"
                            onClick={() => handleMarkRead(n.id)}
                            className="text-[11px] font-semibold text-[#2E7D32] flex items-center gap-0.5 hover:underline"
                          >
                            <Check className="w-3 h-3" /> Mark Read
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="p-4 space-y-4 max-h-[380px] overflow-y-auto text-xs">
              <div className="space-y-2">
                <div className="font-bold text-[#0F2942]">Alert Channels</div>
                {(
                  [
                    { key: 'inApp', label: 'In-App Academic Alerts' },
                    { key: 'email', label: 'Email Digests & Reports' },
                    { key: 'whatsapp', label: 'WhatsApp Parent Alerts' },
                    { key: 'groupedSummary', label: 'Group rapid alerts into periodic digest' },
                  ] as const
                ).map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA] cursor-pointer"
                  >
                    <span className="text-[#0F2942] font-medium">{item.label}</span>
                    <input
                      type="checkbox"
                      checked={prefs[item.key]}
                      onChange={(e) =>
                        handleSavePreferences({ ...prefs, [item.key]: e.target.checked })
                      }
                      className="accent-[#158EE3] w-4 h-4"
                    />
                  </label>
                ))}
              </div>

              {user.role === 'student' && (
                <form
                  onSubmit={handleSaveGuardian}
                  className="pt-3 border-t border-[#E5F0FA] space-y-2.5"
                >
                  <div className="font-bold text-[#0F2942] flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-[#2E7D32]" />
                    <span>Guardian Contact & Consent</span>
                  </div>
                  <input
                    type="text"
                    value={guardianName}
                    onChange={(e) => setGuardianName(e.target.value)}
                    placeholder="Parent / Guardian Name"
                    className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-xs"
                  />
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={guardianVerified}
                      onChange={(e) => setGuardianVerified(e.target.checked)}
                      className="accent-[#2E7D32]"
                    />
                    <span>Guardian contact ({user.whatsappNumber}) verified</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={guardianConsent}
                      onChange={(e) => setGuardianConsent(e.target.checked)}
                      className="accent-[#2E7D32]"
                    />
                    <span>Guardian consented to progress & intervention reports</span>
                  </label>
                  <button
                    type="submit"
                    className="w-full py-2 px-3 bg-[#158EE3] hover:bg-[#1176BE] text-white font-bold rounded-xl"
                  >
                    Save Guardian Settings
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
