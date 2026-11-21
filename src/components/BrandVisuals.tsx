import React from 'react';

export const LOGO_PATH = '/assets/aistudio/1794863002160_b8c299db.jpg';

export function Man5heLogo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const imgClass =
    size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-16 w-16' : 'h-11 w-11';
  const textClass =
    size === 'sm' ? 'text-xl' : size === 'lg' ? 'text-3xl' : 'text-2xl';

  return (
    <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
      <img
        src={LOGO_PATH}
        alt="මං 5හේ Logo"
        referrerPolicy="no-referrer"
        className={`${imgClass} rounded-xl object-cover border border-[#DCEBFA] bg-[#EEF7FF] shrink-0`}
      />
      <span className={`${textClass} font-display font-extrabold tracking-tight leading-none`}>
        <span className="text-[#F9631B]">ම</span>
        <span className="text-[#F5A623]">ං</span>{' '}
        <span className="text-[#1170D1]">5</span>
        <span className="text-[#128BE3]">හේ</span>
      </span>
    </div>
  );
}

export function MascotAvatar({ className = 'w-28 h-28' }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-[#CBE2FA] bg-[#EEF7FF] ${className}`}>
      <img
        src={LOGO_PATH}
        alt="මං 5හේ Mascot"
        referrerPolicy="no-referrer"
        className="w-full h-full object-cover object-center"
      />
    </div>
  );
}

export function DailyLessonIllustration() {
  return (
    <svg viewBox="0 0 80 80" className="w-16 h-16 shrink-0" aria-hidden="true">
      <rect x="14" y="12" width="52" height="58" rx="8" fill="#1D4ED8" stroke="#FFFFFF" strokeWidth="2.5" />
      <rect x="20" y="16" width="42" height="50" rx="5" fill="#EFF6FF" />
      <rect x="28" y="24" width="26" height="6" rx="3" fill="#F5A623" />
      <path d="M41 34 L44 40 L51 41 L46 46 L47 53 L41 49 L35 53 L36 46 L31 41 L38 40 Z" fill="#F5A623" stroke="#0F2942" strokeWidth="1.5" />
      <line x1="26" y1="58" x2="54" y2="58" stroke="#93C5FD" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function MockExamIllustration() {
  return (
    <svg viewBox="0 0 80 80" className="w-16 h-16 shrink-0" aria-hidden="true">
      <rect x="18" y="14" width="44" height="54" rx="7" fill="#FFFFFF" stroke="#0F2942" strokeWidth="2" />
      <rect x="30" y="9" width="20" height="10" rx="4" fill="#F5A623" stroke="#0F2942" strokeWidth="1.8" />
      <rect x="26" y="28" width="28" height="4" rx="2" fill="#CBD5E1" />
      <rect x="26" y="38" width="20" height="4" rx="2" fill="#CBD5E1" />
      <rect x="26" y="48" width="24" height="4" rx="2" fill="#CBD5E1" />
      <circle cx="56" cy="54" r="10" fill="#4CAF50" stroke="#FFFFFF" strokeWidth="2" />
      <path d="M51 54 L54.5 57.5 L61 51" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MemoryLabIllustration() {
  return (
    <svg viewBox="0 0 80 80" className="w-16 h-16 shrink-0" aria-hidden="true">
      <rect x="12" y="18" width="56" height="42" rx="10" fill="#FFF7EB" stroke="#0F2942" strokeWidth="2" />
      <rect x="18" y="24" width="44" height="30" rx="6" fill="#F96A1B" />
      <polygon points="35,31 35,47 49,39" fill="#FFFFFF" />
      <circle cx="62" cy="18" r="7" fill="#4CAF50" stroke="#FFFFFF" strokeWidth="2" />
    </svg>
  );
}

export function PastPaperIllustration() {
  return (
    <svg viewBox="0 0 80 80" className="w-16 h-16 shrink-0" aria-hidden="true">
      <rect x="16" y="14" width="44" height="54" rx="6" fill="#FFFFFF" stroke="#0F2942" strokeWidth="2" />
      <line x1="24" y1="26" x2="50" y2="26" stroke="#94A3B8" strokeWidth="3" strokeLinecap="round" />
      <line x1="24" y1="36" x2="46" y2="36" stroke="#94A3B8" strokeWidth="3" strokeLinecap="round" />
      <line x1="24" y1="46" x2="42" y2="46" stroke="#94A3B8" strokeWidth="3" strokeLinecap="round" />
      <path d="M50 56 L66 40 L71 45 L55 61 L48 63 Z" fill="#F5A623" stroke="#0F2942" strokeWidth="1.8" />
    </svg>
  );
}

export function ScholarshipGauge({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  // Angle from -90 deg (left) to +90 deg (right)
  const angleDeg = -90 + (clamped / 100) * 180;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 115" className="w-48 h-28" aria-label={`Scholarship readiness ${clamped}%`}>
        {/* Low (Red-Orange) */}
        <path
          d="M 24 98 A 76 76 0 0 1 62 32"
          fill="none"
          stroke="#F9631B"
          strokeWidth="16"
          strokeLinecap="round"
        />
        {/* Medium (Gold) */}
        <path
          d="M 66 30 A 76 76 0 0 1 134 30"
          fill="none"
          stroke="#F5A623"
          strokeWidth="16"
        />
        {/* High (Green) */}
        <path
          d="M 138 32 A 76 76 0 0 1 176 98"
          fill="none"
          stroke="#4CAF50"
          strokeWidth="16"
          strokeLinecap="round"
        />
        {/* Needle */}
        <g transform={`translate(100, 98) rotate(${angleDeg})`}>
          <polygon points="-4,0 0,-64 4,0" fill="#0F2942" />
          <circle cx="0" cy="0" r="8" fill="#0F2942" />
          <circle cx="0" cy="0" r="3.5" fill="#FFFFFF" />
        </g>
        <text x="20" y="112" fontSize="10" fill="#526A84" fontWeight="600">Low</text>
        <text x="160" y="112" fontSize="10" fill="#526A84" fontWeight="600">High</text>
      </svg>
      <div className="text-2xl font-display font-extrabold text-[#0F2942] tabular-nums -mt-2">
        {clamped}%
      </div>
    </div>
  );
}

export function StudyRing({ percent, stars }: { percent: number; stars: number }) {
  const clamped = Math.max(5, Math.min(100, percent));
  const r = 34;
  const c = 2 * Math.PI * r;
  const dash = (clamped / 100) * c;

  return (
    <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
      <svg viewBox="0 0 88 88" className="w-24 h-24 -rotate-90" aria-hidden="true">
        <circle cx="44" cy="44" r={r} fill="none" stroke="#E5F1FD" strokeWidth="9" />
        <circle
          cx="44"
          cy="44"
          r={r}
          fill="none"
          stroke="#158EE3"
          strokeWidth="9"
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
        />
        <circle
          cx="44"
          cy="44"
          r={23}
          fill="none"
          stroke="#F96A1B"
          strokeWidth="6"
          strokeDasharray={`${(Math.min(100, stars % 100 || 65) / 100) * (2 * Math.PI * 23)} ${2 * Math.PI * 23}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold text-[#0F2942] tabular-nums">{clamped}%</span>
      </div>
    </div>
  );
}
