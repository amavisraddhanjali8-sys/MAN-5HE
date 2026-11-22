import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { StudyActivityContextMode, StudyActivityEventInput, WellbeingRuleVersion } from './types';

function getStableBrowserId(storage: Storage | undefined, key: string, prefix: string): string {
  try {
    if (storage) {
      const existing = storage.getItem(key);
      if (existing) return existing;
      const created = `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      storage.setItem(key, created);
      return created;
    }
  } catch {
    // ignore storage access errors
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface LiveBreakReminderState {
  shouldSuggestBreak: boolean;
  continuousMinutes: number;
  recommendedBreakMinutes: number;
  timedAssessmentPolicy: WellbeingRuleVersion['timedAssessmentBreakPolicy'];
  message: string;
}

interface UseStudyActivityTrackerOptions {
  enabled: boolean;
  sessionKey: string | null | undefined;
  contextMode: StudyActivityContextMode;
  assessmentId?: string | null;
  scheduledSessionId?: string | null;
  paperId?: string | null;
  subjectId?: string | null;
}

export function useStudyActivityTracker({
  enabled,
  sessionKey,
  contextMode,
  assessmentId,
  scheduledSessionId,
  paperId,
  subjectId,
}: UseStudyActivityTrackerOptions) {
  const [isPaused, setIsPaused] = useState(false);
  const [liveBreakReminder, setLiveBreakReminder] = useState<LiveBreakReminderState | null>(null);
  const [reminderDismissedAt, setReminderDismissedAt] = useState<number>(0);

  const seqRef = useRef(0);
  const lastActivityMsRef = useRef<number>(Date.now());
  const activeSessionRef = useRef<string | null>(null);
  const isPausedRef = useRef(false);
  const deviceIdRef = useRef<string | null>(null);
  const tabIdRef = useRef<string | null>(null);

  if (!deviceIdRef.current && typeof window !== 'undefined') {
    deviceIdRef.current = getStableBrowserId(window.localStorage, 'man5he_device_id', 'dev');
  }
  if (!tabIdRef.current && typeof window !== 'undefined') {
    tabIdRef.current = getStableBrowserId(window.sessionStorage, 'man5he_tab_id', 'tab');
  }

  const sendEvents = useCallback(
    async (events: StudyActivityEventInput[]) => {
      if (events.length === 0) return;
      try {
        const res = await api.ingestStudyActivityEvents(events);
        if (res.liveBreakReminder?.shouldSuggestBreak) {
          const now = Date.now();
          if (now - reminderDismissedAt > 120_000) {
            setLiveBreakReminder(res.liveBreakReminder);
          }
        }
      } catch {
        // non-blocking study telemetry
      }
    },
    [reminderDismissedAt]
  );

  const buildEvent = useCallback(
    (
      key: string,
      eventType: StudyActivityEventInput['eventType'],
      questionId?: string | null
    ): StudyActivityEventInput => {
      seqRef.current += 1;
      return {
        idempotencyKey: `${key}-${eventType}-${seqRef.current}-${Date.now()}`,
        sessionKey: key,
        eventType,
        occurredAt: new Date().toISOString(),
        contextMode,
        deviceId: deviceIdRef.current || 'dev-web',
        tabId: tabIdRef.current || 'tab-web',
        assessmentId: assessmentId ?? null,
        scheduledSessionId: scheduledSessionId ?? null,
        paperId: paperId ?? null,
        subjectId: subjectId ?? null,
        questionId: questionId ?? null,
      };
    },
    [assessmentId, contextMode, paperId, scheduledSessionId, subjectId]
  );

  useEffect(() => {
    if (!enabled || !sessionKey) {
      return;
    }

    activeSessionRef.current = sessionKey;
    setIsPaused(false);
    isPausedRef.current = false;
    setLiveBreakReminder(null);
    lastActivityMsRef.current = Date.now();

    void sendEvents([buildEvent(sessionKey, 'session_open')]);

    const markUserActive = () => {
      lastActivityMsRef.current = Date.now();
    };

    const handleVisibility = () => {
      if (!activeSessionRef.current) return;
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      void sendEvents([
        buildEvent(activeSessionRef.current, hidden ? 'tab_backgrounded' : 'tab_resumed'),
      ]);
      if (!hidden) {
        lastActivityMsRef.current = Date.now();
      }
    };

    const handleOffline = () => {
      if (!activeSessionRef.current) return;
      void sendEvents([buildEvent(activeSessionRef.current, 'network_disconnected')]);
    };

    const handleOnline = () => {
      if (!activeSessionRef.current) return;
      void sendEvents([buildEvent(activeSessionRef.current, 'network_reconnected')]);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', markUserActive, { passive: true });
      window.addEventListener('keydown', markUserActive, { passive: true });
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    const heartbeatTimer = window.setInterval(() => {
      if (!activeSessionRef.current || isPausedRef.current) return;
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (hidden) return;
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (offline) return;
      // Only emit active heartbeat when recent pointer/key/question activity occurred (< 90s)
      if (Date.now() - lastActivityMsRef.current <= 90_000) {
        void sendEvents([buildEvent(activeSessionRef.current, 'interaction_heartbeat')]);
      }
    }, 25_000);

    return () => {
      window.clearInterval(heartbeatTimer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointerdown', markUserActive);
        window.removeEventListener('keydown', markUserActive);
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
      if (activeSessionRef.current) {
        const closingKey = activeSessionRef.current;
        activeSessionRef.current = null;
        void sendEvents([buildEvent(closingKey, 'session_closed')]);
      }
    };
  }, [enabled, sessionKey, buildEvent, sendEvents]);

  const trackInteraction = useCallback(
    (
      eventType: 'question_viewed' | 'answer_selected' | 'hint_opened',
      questionId?: string | null
    ) => {
      lastActivityMsRef.current = Date.now();
      if (!enabled || !activeSessionRef.current) return;
      void sendEvents([buildEvent(activeSessionRef.current, eventType, questionId)]);
    },
    [buildEvent, enabled, sendEvents]
  );

  const togglePauseBreak = useCallback(() => {
    if (!enabled || !activeSessionRef.current) return;
    const nextPaused = !isPausedRef.current;
    isPausedRef.current = nextPaused;
    setIsPaused(nextPaused);
    lastActivityMsRef.current = Date.now();
    void sendEvents([
      buildEvent(activeSessionRef.current, nextPaused ? 'break_started' : 'break_ended'),
    ]);
    if (!nextPaused) {
      setLiveBreakReminder(null);
    }
  }, [buildEvent, enabled, sendEvents]);

  const dismissBreakReminder = useCallback(() => {
    setReminderDismissedAt(Date.now());
    setLiveBreakReminder(null);
  }, []);

  const closeSession = useCallback(() => {
    if (!activeSessionRef.current) return;
    const closingKey = activeSessionRef.current;
    activeSessionRef.current = null;
    void sendEvents([buildEvent(closingKey, 'session_closed')]);
  }, [buildEvent, sendEvents]);

  return {
    isPaused,
    liveBreakReminder,
    trackInteraction,
    togglePauseBreak,
    dismissBreakReminder,
    closeSession,
  };
}
