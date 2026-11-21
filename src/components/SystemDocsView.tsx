import React from 'react';
import { Database, Lock, Mail, Server, ShieldCheck } from 'lucide-react';

export function SystemDocsView() {
  const envVars = [
    { key: 'AUTH_SESSION_SECRET', desc: '256-bit HMAC key signing authenticated student & admin Bearer tokens' },
    { key: 'CAPTCHA_SIGNING_SECRET', desc: 'HMAC secret signing SVG math CAPTCHA challenges & timestamps' },
    { key: 'TOTP_ISSUER_NAME', desc: 'Issuer label displayed inside Google Authenticator (Man5he Scholarship)' },
    { key: 'SMTP_HOST / SMTP_USER / SMTP_PASS', desc: 'Outbound SMTP transport for OTP, Invoice, and Progress HTML emails' },
    { key: 'WHATSAPP_PHONE_NUMBER_ID / TOKEN', desc: 'Meta WhatsApp Cloud API credentials for automated parent alerts' },
    { key: 'PAYHERE_MERCHANT_ID / SECRET', desc: 'Sri Lanka LKR PayHere gateway HMAC-SHA256 verification keys' },
    { key: 'STRIPE_SECRET_KEY / WEBHOOK_SECRET', desc: 'Card payment gateway checkout & signed webhook verification' },
    { key: 'DATA_STORE_PATH', desc: 'Persistent JSON / database storage path (./data/db.json)' },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 sm:p-8">
        <h1 className="text-2xl font-display font-extrabold text-[#0F2942]">
          මං 5හේ · System Architecture, Security & Environment Specification
        </h1>
        <p className="text-sm text-[#526A84] mt-1">
          Full documentation is also saved in <code className="font-mono text-[#158EE3]">/SYSTEM.md</code> and <code className="font-mono text-[#158EE3]">/.env.example</code>.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <div className="p-4 rounded-2xl bg-[#F3F9FF] border border-[#DCEBFA] space-y-1.5">
            <ShieldCheck className="w-5 h-5 text-[#158EE3]" />
            <div className="text-sm font-bold text-[#0F2942]">4-Layer Auth & Payment</div>
            <p className="text-xs text-[#526A84]">
              Scrypt password + SVG CAPTCHA + Honeypot Robot Check + Email OTP + RFC 6238 Google Authenticator TOTP.
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-[#FFF7EB] border border-[#FDE1B2] space-y-1.5">
            <Database className="w-5 h-5 text-[#F5A623]" />
            <div className="text-sm font-bold text-[#0F2942]">500,000+ Hybrid Pool</div>
            <p className="text-xs text-[#526A84]">
              Curated Admin DB quizzes (with Canvas drawings & images) + seeded Fisher-Yates 500K parametric generator.
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-[#EEF9EF] border border-[#C1E8C4] space-y-1.5">
            <Server className="w-5 h-5 text-[#4CAF50]" />
            <div className="text-sm font-bold text-[#0F2942]">Psychometric Engine</div>
            <p className="text-xs text-[#526A84]">
              Computes Paper Quality Index, Difficulty Category, Scholarship Estimator gauge, and Student Level progression.
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-[#FFF2ED] border border-[#FAC5B2] space-y-1.5">
            <Mail className="w-5 h-5 text-[#F96A1B]" />
            <div className="text-sm font-bold text-[#0F2942]">Auto Email & WhatsApp</div>
            <p className="text-xs text-[#526A84]">
              Branded HTML invoices, OTP mails, and automatic exam progress reports sent to parents immediately.
            </p>
          </div>
        </div>
      </div>

      {/* Mathematical Formulas & Environment Variables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
          <h2 className="text-base font-display font-bold text-[#0F2942] flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#158EE3]" />
            <span>Psychometric & Paper Quality Formulas</span>
          </h2>
          <div className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] font-mono text-xs text-[#0F2942] space-y-2">
            <div>QuizDifficulty = 0.42*(100*WrongProb) + 0.30*Intel + 0.18*Strength + 0.10*(10*Priority)</div>
            <div>PaperQuality = 0.30*AvgStrength + 0.25*(10*AvgPriority) + 0.20*DomainCov + 0.15*VarianceBalance + 0.10*Length</div>
            <div>ExamIntegrity = strip(correctIndex, memoryTrickBody, explanation) during timed session</div>
          </div>
          <p className="text-xs text-[#526A84] leading-relaxed">
            Papers are automatically categorized into <strong>Foundation Simple</strong> (&lt;36), <strong>Balanced Standard</strong> (36–54.9), <strong>Advanced Challenging</strong> (55–72.9), or <strong>Scholarship Master</strong> (&ge;73), driving adaptive student progression.
          </p>
        </section>

        <section className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
          <h2 className="text-base font-display font-bold text-[#0F2942]">
            Required Environment Variables (.env.example)
          </h2>
          <div className="space-y-2">
            {envVars.map((v) => (
              <div
                key={v.key}
                className="p-2.5 rounded-xl bg-[#F8FBFF] border border-[#E5F0FA] text-xs"
              >
                <div className="font-mono font-bold text-[#158EE3]">{v.key}</div>
                <div className="text-[#526A84] mt-0.5">{v.desc}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
