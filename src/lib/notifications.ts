import type {
  AttemptRecord,
  InvoiceRecord,
  ParentAssessmentReport,
  StudentTrajectory,
} from './types.ts';

function renderMan5heEmailShell(params: {
  title: string;
  subtitle: string;
  accentColor: string;
  bodyHtml: string;
}): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:24px;background-color:#EAF5FF;font-family:'Plus Jakarta Sans','DM Sans',Arial,sans-serif;color:#0F2942;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;background:#FFFFFF;border-radius:20px;border:1px solid #D5E8FA;overflow:hidden;">
    <tr>
      <td style="padding:24px 28px;background:linear-gradient(135deg,#DCEEFF 0%,#F3F9FF 100%);border-bottom:1px solid #D5E8FA;">
        <table width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td>
              <div style="font-size:24px;font-weight:800;letter-spacing:-0.5px;">
                <span style="color:#F9631B;">ම</span><span style="color:#F5A623;">ං</span>
                <span style="color:#1170D1;"> 5</span><span style="color:#128BE3;">හේ</span>
              </div>
              <div style="font-size:12px;color:#476481;margin-top:2px;">Sri Lanka Grade 5 Scholarship Academy</div>
            </td>
            <td align="right">
              <span style="display:inline-block;padding:6px 12px;border-radius:8px;background:${params.accentColor};color:#FFFFFF;font-size:12px;font-weight:700;">
                Official Verification
              </span>
            </td>
          </tr>
        </table>
        <h1 style="margin:18px 0 4px 0;font-size:22px;line-height:1.3;color:#0F2942;">${params.title}</h1>
        <p style="margin:0;font-size:14px;color:#476481;">${params.subtitle}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:26px 28px;font-size:14px;line-height:1.6;color:#233B53;">
        ${params.bodyHtml}
      </td>
    </tr>
    <tr>
      <td style="padding:18px 28px;background:#F7FBFF;border-top:1px solid #E5F0FA;font-size:12px;color:#5A748E;">
        <div>මං 5හේ (Man 5he) Scholarship Platform · Automated Security & Parent Progress Desk</div>
        <div style="margin-top:4px;">Protected by Email OTP, Google Authenticator TOTP & Signed Gateway Receipts</div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildOtpEmailHtml(params: {
  recipientName: string;
  purpose: 'Registration' | 'Secure Login' | 'Payment Creation';
  otpCode: string;
  userIdCode: string;
}): string {
  const color =
    params.purpose === 'Payment Creation'
      ? '#4CAF50'
      : params.purpose === 'Secure Login'
      ? '#158EE3'
      : '#F96A1B';

  return renderMan5heEmailShell({
    title: `${params.purpose} Verification Code`,
    subtitle: `ආයුබෝවන් ${params.recipientName}, verify your action on මං 5හේ`,
    accentColor: color,
    bodyHtml: `
      <p style="margin-top:0;">Use the 6-digit security verification code below to authorize <strong>${params.purpose}</strong> for student/parent account <strong>${params.userIdCode}</strong>:</p>
      <div style="margin:20px 0;padding:18px;border-radius:14px;background:#F3F9FF;border:2px dashed #158EE3;text-align:center;">
        <div style="font-size:12px;color:#526A84;margin-bottom:6px;">One-Time Email Verification Code (Expires in 10 minutes)</div>
        <div style="font-size:32px;font-weight:800;letter-spacing:8px;font-family:monospace;color:#0F2942;">${params.otpCode}</div>
      </div>
      <p style="margin-bottom:0;color:#526A84;">If you did not initiate this request, please secure your Google Authenticator and password immediately.</p>
    `,
  });
}

export function buildInvoiceEmailHtml(invoice: InvoiceRecord): string {
  return renderMan5heEmailShell({
    title: `Payment Receipt & Invoice ${invoice.invoiceNumber}`,
    subtitle: `Subscription confirmed for ${invoice.userName}`,
    accentColor: '#4CAF50',
    bodyHtml: `
      <p style="margin-top:0;">Thank you for investing in your child's Grade 5 Scholarship journey. Your payment has been cryptographically verified.</p>
      <table width="100%" cellspacing="0" cellpadding="8" style="border-collapse:collapse;margin:16px 0;background:#F9FCFF;border:1px solid #DCEBFA;border-radius:10px;">
        <tr style="background:#EBF5FF;font-weight:700;color:#0F2942;">
          <td align="left">Invoice Detail</td>
          <td align="right">Value</td>
        </tr>
        <tr><td>Invoice Number</td><td align="right" style="font-family:monospace;font-weight:700;">${invoice.invoiceNumber}</td></tr>
        <tr><td>Plan</td><td align="right">${invoice.planName}</td></tr>
        <tr><td>Payment Gateway</td><td align="right">${invoice.gateway}</td></tr>
        <tr><td>Gateway Reference</td><td align="right" style="font-family:monospace;">${invoice.gatewayRef}</td></tr>
        <tr><td>Signature Status</td><td align="right" style="color:#2E7D32;font-weight:700;">HMAC-SHA256 Verified</td></tr>
        <tr style="border-top:2px solid #DCEBFA;font-size:16px;font-weight:800;">
          <td>Total Paid</td>
          <td align="right" style="color:#F96A1B;">LKR ${invoice.amountLkr.toLocaleString('en-LK')}.00</td>
        </tr>
      </table>
      <p style="margin-bottom:0;">Full access to the 500,000+ shuffled quiz bank, child psychological memory tricks, and timed scholarship papers is now unlocked.</p>
    `,
  });
}

export function buildProgressEmailHtml(params: {
  studentName: string;
  attempt: AttemptRecord;
  trajectory: StudentTrajectory;
}): string {
  const { studentName, attempt, trajectory } = params;
  const weakList =
    trajectory.weakDomains.length > 0
      ? trajectory.weakDomains
          .map(
            (w) =>
              `<li><strong>${w.domain}</strong>: ${w.accuracyPercent}% accuracy</li>`
          )
          .join('')
      : '<li>All attempted domains are currently above 75% accuracy!</li>';

  return renderMan5heEmailShell({
    title: `Student Progress Report · ${attempt.paperTitle}`,
    subtitle: `Parent Tracker Update for ${studentName} (${attempt.paperCategory})`,
    accentColor: '#F5A623',
    bodyHtml: `
      <p style="margin-top:0;">Here is the automated learning & scholarship readiness summary after completing <strong>${attempt.paperTitle}</strong>:</p>
      <table width="100%" cellspacing="0" cellpadding="10" style="margin:14px 0;background:#F3F9FF;border-radius:12px;border:1px solid #DCEBFA;">
        <tr>
          <td width="33%" align="center" style="border-right:1px solid #DCEBFA;">
            <div style="font-size:11px;color:#526A84;">Score</div>
            <div style="font-size:22px;font-weight:800;color:#158EE3;">${attempt.scorePercent}%</div>
          </td>
          <td width="33%" align="center" style="border-right:1px solid #DCEBFA;">
            <div style="font-size:11px;color:#526A84;">Scholarship Estimator</div>
            <div style="font-size:22px;font-weight:800;color:#4CAF50;">${trajectory.scholarshipReadinessPercent}%</div>
          </td>
          <td width="33%" align="center">
            <div style="font-size:11px;color:#526A84;">Recommended Level</div>
            <div style="font-size:14px;font-weight:700;color:#F96A1B;">${trajectory.recommendedNextLevel}</div>
          </td>
        </tr>
      </table>
      <p><strong>Time Spent:</strong> ${Math.round(attempt.timeSpentSeconds / 60)} min ${attempt.timeSpentSeconds % 60} sec · <strong>Stars Earned:</strong> +${attempt.starsEarned} Stars</p>
      <p style="margin-bottom:6px;"><strong>Areas to Improve (වැඩිදියුණු විය යුතු කොටස්):</strong></p>
      <ul style="margin-top:0;padding-left:18px;">${weakList}</ul>
      <div style="padding:12px 14px;background:#FFF7EB;border:1px solid #FDE1B2;border-radius:10px;color:#7C4D00;">
        <strong>Psychometric Insight:</strong> ${trajectory.recommendationNote}
      </div>
    `,
  });
}

export function buildWhatsAppProgressMessage(params: {
  studentName: string;
  attempt: AttemptRecord;
  trajectory: StudentTrajectory;
}): string {
  const { studentName, attempt, trajectory } = params;
  const weakArea =
    trajectory.weakDomains.length > 0
      ? `${trajectory.weakDomains[0].domain} (${trajectory.weakDomains[0].accuracyPercent}%)`
      : 'Keep practicing daily!';
  return [
    `🌟 *මං 5හේ (Man 5he) Parent Progress Alert*`,
    `Student: ${studentName}`,
    `Completed: ${attempt.paperTitle} (${attempt.mode === 'timed_exam' ? 'Timed Exam' : 'Practice Round'})`,
    `Score: ${attempt.correctCount}/${attempt.totalQuestions} (${attempt.scorePercent}%) | +${attempt.starsEarned} Stars`,
    `Scholarship Readiness: ${trajectory.scholarshipReadinessPercent}%`,
    `Next Level: ${trajectory.recommendedNextLevel}`,
    `Focus Area: ${weakArea}`,
  ].join('\n');
}

export function buildKnowledgeEmailHtml(params: {
  recipientName: string;
  publicationTitle: string;
  publicationId: string;
  subjectName: string;
  targetGrades: string[];
  summary: string;
  sourceTitle: string;
  deepLinkPath: string;
  isCorrection?: boolean;
  correctionNotice?: string | null;
}): string {
  const badgeColor = params.isCorrection ? '#D97706' : '#158EE3';
  const correctionBanner = params.isCorrection
    ? `<div style="margin:0 0 16px 0;padding:12px 14px;border-radius:12px;background:#FFF7EB;border:1px solid #FAD49B;color:#7C4D00;">
         <strong>Correction / Update Notice:</strong> ${params.correctionNotice || 'Updated educational verification notice.'}
       </div>`
    : '';

  return renderMan5heEmailShell({
    title: params.isCorrection
      ? `Correction Notice · ${params.publicationTitle}`
      : `New Learning Guide · ${params.publicationTitle}`,
    subtitle: `${params.subjectName} · For ${params.targetGrades.join(', ')} · Prepared for ${params.recipientName}`,
    accentColor: badgeColor,
    bodyHtml: `
      ${correctionBanner}
      <p style="margin-top:0;">${params.summary}</p>
      <table width="100%" cellspacing="0" cellpadding="10" style="margin:16px 0;background:#F3F9FF;border-radius:12px;border:1px solid #DCEBFA;">
        <tr>
          <td><strong>Publication ID</strong></td>
          <td align="right" style="font-family:monospace;">${params.publicationId}</td>
        </tr>
        <tr>
          <td><strong>Curriculum Subject</strong></td>
          <td align="right">${params.subjectName}</td>
        </tr>
        <tr>
          <td><strong>Verified Source</strong></td>
          <td align="right">${params.sourceTitle || 'MAN 5HE Editorial Desk'}</td>
        </tr>
      </table>
      <p style="margin:18px 0;">
        <a href="${params.deepLinkPath}" style="display:inline-block;padding:10px 18px;border-radius:10px;background:#158EE3;color:#FFFFFF;text-decoration:none;font-weight:700;">
          Open in මං 5හේ Knowledge Hub →
        </a>
      </p>
      <p style="margin-bottom:0;font-size:12px;color:#526A84;">
        Manage your notification preferences anytime inside Alerts &amp; Profile → Preferences &amp; Consent.
      </p>
    `,
  });
}

export function buildKnowledgeWhatsAppMessage(params: {
  recipientName: string;
  publicationTitle: string;
  publicationId: string;
  subjectName: string;
  targetGrades: string[];
  summary: string;
  deepLinkPath: string;
  isCorrection?: boolean;
  correctionNotice?: string | null;
}): string {
  const header = params.isCorrection
    ? `⚠️ *මං 5හේ Correction Notice (${params.publicationId})*`
    : `📚 *මං 5හේ Knowledge Update (${params.publicationId})*`;
  return [
    header,
    `For: ${params.recipientName} (${params.targetGrades.join(', ')})`,
    `Subject: ${params.subjectName}`,
    `Title: ${params.publicationTitle}`,
    params.isCorrection && params.correctionNotice ? `Correction: ${params.correctionNotice}` : null,
    `Summary: ${params.summary}`,
    `Open Guide: ${params.deepLinkPath}`,
    `Manage alerts in Profile Preferences.`,
  ]
    .filter(Boolean)
    .join('\n');
}

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function sanitizeRenderableUrl(rawUrl?: string | null): string | null {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export function buildPasswordRecoveryEmailHtml(params: {
  recipientName: string;
  purposeTitle: string;
  otpCode: string;
  expiresInMinutes: number;
  userIdCode: string;
  supportEmail?: string;
}): string {
  const support = escapeHtml(params.supportEmail || 'support@man5he.lk');
  return renderMan5heEmailShell({
    title: params.purposeTitle,
    subtitle: `Security verification requested for ${escapeHtml(params.recipientName)} (${escapeHtml(params.userIdCode)})`,
    accentColor: '#158EE3',
    bodyHtml: `
      <p style="margin-top:0;">Use the single-use 6-digit security verification code below to complete your <strong>${escapeHtml(params.purposeTitle)}</strong> request on මං 5හේ:</p>
      <div style="margin:20px 0;padding:20px;border-radius:14px;background:#F3F9FF;border:2px dashed #158EE3;text-align:center;">
        <div style="font-size:12px;color:#476481;margin-bottom:8px;">One-Time Security Code · Expires in ${params.expiresInMinutes} minutes</div>
        <div style="font-size:34px;font-weight:800;letter-spacing:8px;font-family:monospace;color:#0F2942;">${escapeHtml(params.otpCode)}</div>
      </div>
      <div style="padding:14px 16px;border-radius:12px;background:#FFF5EE;border:1px solid #FAD0B9;color:#7C2D12;font-size:13px;margin-bottom:16px;">
        <strong>Security Warning:</strong> Never share this verification code with anyone. මං 5හේ staff will never ask for your password, one-time codes, backup codes, or Google Authenticator key. If you did not request this code, ignore this message and review your Account &amp; Security activity.
      </div>
      <p style="margin-bottom:0;font-size:12px;color:#526A84;">
        Need help? Contact the මං 5හේ Safety &amp; Support Desk at <a href="mailto:${support}" style="color:#158EE3;font-weight:600;text-decoration:none;">${support}</a>.
      </p>
    `,
  });
}

export function buildSecurityAlertEmailHtml(params: {
  recipientName: string;
  headline: string;
  summary: string;
  actionTimeIso: string;
  supportEmail?: string;
}): string {
  const support = escapeHtml(params.supportEmail || 'support@man5he.lk');
  return renderMan5heEmailShell({
    title: `Security Notice · ${escapeHtml(params.headline)}`,
    subtitle: `Account protection alert for ${escapeHtml(params.recipientName)}`,
    accentColor: '#F96A1B',
    bodyHtml: `
      <p style="margin-top:0;">${escapeHtml(params.summary)}</p>
      <table width="100%" cellspacing="0" cellpadding="10" style="margin:16px 0;background:#F9FCFF;border:1px solid #DCEBFA;border-radius:10px;">
        <tr>
          <td><strong>Security Event</strong></td>
          <td align="right">${escapeHtml(params.headline)}</td>
        </tr>
        <tr>
          <td><strong>Recorded At</strong></td>
          <td align="right" style="font-family:monospace;">${escapeHtml(new Date(params.actionTimeIso).toUTCString())}</td>
        </tr>
      </table>
      <p style="margin-bottom:0;font-size:13px;color:#526A84;">
        If you did not authorize this change, revoke active sessions immediately in <strong>Account &amp; Security</strong> or contact <a href="mailto:${support}" style="color:#158EE3;">${support}</a>.
      </p>
    `,
  });
}

export function buildWhatsAppRecoveryTemplatePayload(params: {
  templateName?: string;
  otpCode: string;
  expiresInMinutes: number;
  maskedDestination: string;
}) {
  const templateName = params.templateName || 'man5he_auth_otp_v1';
  return {
    templateName,
    languageCode: 'en',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.otpCode },
          { type: 'text', text: String(params.expiresInMinutes) },
        ],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: params.otpCode }],
      },
    ],
    redactedAuditSummary: `WhatsApp Business authentication template '${templateName}' sent to ${params.maskedDestination} (valid ${params.expiresInMinutes} min, code redacted).`,
  };
}

export function buildWhatsAppSecurityAlert(params: {
  headline: string;
  summary: string;
}): string {
  return [
    `🔐 *මං 5හේ Security Notice*`,
    params.headline,
    params.summary,
    `If this wasn't you, open Account & Security immediately to revoke sessions.`,
  ].join('\n');
}

export function buildParentReportEmailHtml(params: {
  guardianName: string;
  report: ParentAssessmentReport;
  appBaseUrl?: string;
}): { html: string; text: string } {
  const { guardianName, report, appBaseUrl = '' } = params;
  const fullUrl = appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}${report.secureReportPath}` : report.secureReportPath;
  const scoreLabel =
    report.finalizationStatus === 'pending_manual_marking' || report.scorePercent === null
      ? 'Awaiting Teacher Manual Marking'
      : `${report.scorePercent}% (${report.awardedMarks}/${report.maxMarks} marks)`;

  const weakHtml =
    report.mainImprovementAreas.length > 0
      ? report.mainImprovementAreas
          .map(
            (a) =>
              `<li><strong>${escapeHtml(a.subjectName)} · ${escapeHtml(a.topicName)}</strong> (${a.accuracyPercent}%): ${escapeHtml(a.recommendedAction)}</li>`
          )
          .join('')
      : '<li>All attempted topics met or exceeded the target benchmark.</li>';

  const resHtml =
    report.recommendedResources.length > 0
      ? `<p style="margin-bottom:6px;"><strong>Recommended Learning Guides:</strong></p><ul style="margin-top:0;padding-left:18px;">${report.recommendedResources
          .map((r) => `<li><strong>${escapeHtml(r.title)}</strong> (${escapeHtml(r.subjectName)}) — ${escapeHtml(r.summary)}</li>`)
          .join('')}</ul>`
      : '';

  const html = renderMan5heEmailShell({
    title: `${report.finalizationStatus === 'finalized' ? 'Final Learning Report' : 'Completion Update'} · ${escapeHtml(report.assessmentTitle)}`,
    subtitle: `Prepared for ${escapeHtml(guardianName)} · Student: ${escapeHtml(report.studentName)} (${escapeHtml(report.studentUserIdCode)})`,
    accentColor: report.finalizationStatus === 'finalized' ? '#158EE3' : '#D97706',
    bodyHtml: `
      <p style="margin-top:0;">${escapeHtml(report.parentSummary)}</p>
      <table width="100%" cellspacing="0" cellpadding="10" style="margin:14px 0;background:#F3F9FF;border-radius:12px;border:1px solid #DCEBFA;">
        <tr>
          <td width="33%" align="center" style="border-right:1px solid #DCEBFA;">
            <div style="font-size:11px;color:#526A84;">Result</div>
            <div style="font-size:16px;font-weight:800;color:#158EE3;">${escapeHtml(scoreLabel)}</div>
          </td>
          <td width="33%" align="center" style="border-right:1px solid #DCEBFA;">
            <div style="font-size:11px;color:#526A84;">Correct / Needs Review</div>
            <div style="font-size:16px;font-weight:800;color:#0F2942;">${report.correctCount} / ${report.incorrectCount + report.partialCount}</div>
          </td>
          <td width="33%" align="center">
            <div style="font-size:11px;color:#526A84;">Unanswered / Pending</div>
            <div style="font-size:16px;font-weight:800;color:#476481;">${report.unansweredCount} / ${report.pendingCount}</div>
          </td>
        </tr>
      </table>
      <p style="margin-bottom:6px;"><strong>Main Learning Focus Areas:</strong></p>
      <ul style="margin-top:0;padding-left:18px;">${weakHtml}</ul>
      ${resHtml}
      <div style="padding:12px 14px;background:#EEF9EF;border:1px solid #C1E8C4;border-radius:10px;color:#1E6323;margin-bottom:16px;">
        <strong>Encouragement Tip:</strong> ${escapeHtml(report.encouragementNote)}
      </div>
      <p style="margin:16px 0;">
        <a href="${escapeHtml(sanitizeRenderableUrl(fullUrl) || '/?tab=progress')}" style="display:inline-block;padding:10px 18px;border-radius:10px;background:#158EE3;color:#FFFFFF;text-decoration:none;font-weight:700;">
          Sign in to View Question-by-Question Teaching Guide →
        </a>
      </p>
      <p style="margin-bottom:0;font-size:12px;color:#526A84;">
        For child privacy, full question responses and teaching guides require authenticated guardian sign-in. You can update notification preferences anytime inside Profile &amp; Preferences.
      </p>
    `,
  });

  const text = [
    `MAN 5HE ${report.finalizationStatus === 'finalized' ? 'Final Learning Report' : 'Completion Update'}`,
    `Guardian: ${guardianName} | Student: ${report.studentName} (${report.studentUserIdCode})`,
    `Assessment: ${report.assessmentTitle}`,
    `Result: ${scoreLabel}`,
    `Breakdown: ${report.correctCount} correct, ${report.incorrectCount} incorrect, ${report.partialCount} partial, ${report.unansweredCount} unanswered, ${report.pendingCount} pending teacher marking`,
    `Focus Areas: ${
      report.mainImprovementAreas.map((a) => `${a.subjectName} (${a.topicName})`).join('; ') || 'All benchmarked areas strong'
    }`,
    `Authenticated Report Link (Sign-in Required): ${fullUrl}`,
  ].join('\n');

  return { html, text };
}

export function buildWhatsAppParentReportPayload(params: {
  guardianName: string;
  report: ParentAssessmentReport;
  appBaseUrl?: string;
}) {
  const { guardianName, report, appBaseUrl = '' } = params;
  const fullUrl = appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}${report.secureReportPath}` : report.secureReportPath;
  const scoreSummary =
    report.finalizationStatus === 'pending_manual_marking' || report.scorePercent === null
      ? 'Submitted (pending teacher marking)'
      : `${report.scorePercent}% (${report.awardedMarks}/${report.maxMarks})`;
  const focus =
    report.mainImprovementAreas[0]
      ? `${report.mainImprovementAreas[0].subjectName}: ${report.mainImprovementAreas[0].topicName}`
      : 'Keep steady daily practice';
  const templateName =
    report.finalizationStatus === 'finalized'
      ? 'man5he_parent_final_report_v1'
      : 'man5he_parent_completion_notice_v1';

  return {
    templateName,
    languageCode: 'en',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: guardianName },
          { type: 'text', text: report.studentName },
          { type: 'text', text: report.assessmentTitle },
          { type: 'text', text: scoreSummary },
          { type: 'text', text: `${report.correctCount} correct / ${report.incorrectCount + report.partialCount} to review` },
          { type: 'text', text: focus },
        ],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: fullUrl }],
      },
    ],
    messageText: [
      `📘 *මං 5හේ Parent Learning Report*`,
      `Guardian: ${guardianName} · Child: ${report.studentName}`,
      `Completed: ${report.assessmentTitle}`,
      `Score: ${scoreSummary} (${report.correctCount} correct, ${report.incorrectCount} incorrect, ${report.unansweredCount} unanswered)`,
      `Focus Area: ${focus}`,
      `Sign in to open question teaching steps: ${fullUrl}`,
    ].join('\n'),
  };
}

export function buildSessionReminderEmailHtml(params: {
  recipientName: string;
  studentName: string;
  sessionTitle: string;
  subjectLabel: string;
  localDateTimeReadable: string;
  timeZone: string;
  durationMinutes: number;
  timeRemainingText: string;
  activityPath: string;
}): { html: string; text: string } {
  const html = renderMan5heEmailShell({
    title: `Study Session Reminder · ${escapeHtml(params.sessionTitle)}`,
    subtitle: `For ${escapeHtml(params.studentName)} · ${escapeHtml(params.timeRemainingText)}`,
    accentColor: '#158EE3',
    bodyHtml: `
      <p style="margin-top:0;">Hi ${escapeHtml(params.recipientName)}, here is a friendly reminder for your upcoming scheduled learning activity:</p>
      <table width="100%" cellspacing="0" cellpadding="10" style="margin:14px 0;background:#F3F9FF;border-radius:12px;border:1px solid #DCEBFA;">
        <tr><td><strong>Session</strong></td><td align="right">${escapeHtml(params.sessionTitle)}</td></tr>
        <tr><td><strong>Subject / Focus</strong></td><td align="right">${escapeHtml(params.subjectLabel)}</td></tr>
        <tr><td><strong>Scheduled Time</strong></td><td align="right">${escapeHtml(params.localDateTimeReadable)} (${escapeHtml(params.timeZone)})</td></tr>
        <tr><td><strong>Duration</strong></td><td align="right">${params.durationMinutes} minutes</td></tr>
        <tr><td><strong>Status at Dispatch</strong></td><td align="right">${escapeHtml(params.timeRemainingText)}</td></tr>
      </table>
      <p style="margin:16px 0;">
        <a href="${escapeHtml(sanitizeRenderableUrl(params.activityPath) || '/')}" style="display:inline-block;padding:10px 18px;border-radius:10px;background:#158EE3;color:#FFFFFF;text-decoration:none;font-weight:700;">
          Open Scheduled Activity →
        </a>
      </p>
    `,
  });

  const text = [
    `MAN 5HE Study Reminder: ${params.sessionTitle}`,
    `Student: ${params.studentName} | Subject: ${params.subjectLabel}`,
    `When: ${params.localDateTimeReadable} (${params.timeZone}) · Duration: ${params.durationMinutes} min`,
    `Notice: ${params.timeRemainingText}`,
    `Open Activity (Sign-in Required): ${params.activityPath}`,
  ].join('\n');

  return { html, text };
}

export function buildWhatsAppReminderPayload(params: {
  studentName: string;
  sessionTitle: string;
  subjectLabel: string;
  localDateTimeReadable: string;
  timeZone: string;
  durationMinutes: number;
  timeRemainingText: string;
  activityPath: string;
}) {
  return {
    templateName: 'man5he_study_reminder_v1',
    languageCode: 'en',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.studentName },
          { type: 'text', text: params.sessionTitle },
          { type: 'text', text: `${params.localDateTimeReadable} (${params.timeZone})` },
          { type: 'text', text: `${params.durationMinutes} min` },
          { type: 'text', text: params.timeRemainingText },
        ],
      },
    ],
    messageText: [
      `⏰ *මං 5හේ Learning Reminder*`,
      `Student: ${params.studentName}`,
      `Activity: ${params.sessionTitle} (${params.subjectLabel})`,
      `Time: ${params.localDateTimeReadable} (${params.timeZone}) · ${params.durationMinutes} min`,
      `${params.timeRemainingText}`,
      `Start in app: ${params.activityPath}`,
    ].join('\n'),
  };
}

export function buildAccessibleReportHtmlDocument(report: ParentAssessmentReport): string {
  const questionBlocks = report.items
    .map((item, idx) => {
      const statusText =
        item.correctnessStatus === 'correct'
          ? 'Correct'
          : item.correctnessStatus === 'partially_correct'
          ? 'Partially Correct'
          : item.correctnessStatus === 'pending_manual'
          ? 'Pending Teacher Marking'
          : item.correctnessStatus === 'unanswered'
          ? 'Unanswered'
          : 'Needs Review (Incorrect)';
      const safeImgUrl = sanitizeRenderableUrl(item.imageUrl);
      const imgBlock = safeImgUrl
        ? `<p><img src="${escapeHtml(safeImgUrl)}" alt="Diagram for question ${idx + 1}" style="max-width:360px;border:1px solid #DCEBFA;border-radius:8px;" /></p>`
        : '';
      const guidanceHtml =
        item.correctnessStatus === 'correct'
          ? `<p><strong>Short Reinforcement Note:</strong> ${escapeHtml(item.teachingGuidance.shortCorrectNote)}</p>`
          : `<div style="background:#F8FBFF;border:1px solid #CBE2FA;border-radius:10px;padding:12px;margin-top:8px;">
              <h4 style="margin:0 0 6px 0;">Parent Teaching Guide (${escapeHtml(item.subjectName)} · ${escapeHtml(item.topicName)})</h4>
              <p><strong>1. What this tests:</strong> ${escapeHtml(item.teachingGuidance.whatItTests)}</p>
              <p><strong>2. Correct steps:</strong> ${item.teachingGuidance.correctSolutionSteps.map(escapeHtml).join(' ')}</p>
              <p><strong>3. Plausible error reasons:</strong> ${item.teachingGuidance.plausibleErrorReasons.map(escapeHtml).join(' ')}</p>
              <p><strong>4. Teaching method:</strong> ${escapeHtml(item.teachingGuidance.teachingMethod)}</p>
              <p><strong>5. Practical examples:</strong> ${item.teachingGuidance.practicalExamples.map(escapeHtml).join(' | ')}</p>
              <p><strong>6. Questions to ask your child:</strong> ${item.teachingGuidance.questionsToAskChild.map(escapeHtml).join(' | ')}</p>
              <p><strong>7. Common mistakes to avoid:</strong> ${item.teachingGuidance.commonMistakesToAvoid.map(escapeHtml).join(' | ')}</p>
              <p><strong>8. Suggested follow-up practice:</strong> ${escapeHtml(item.teachingGuidance.followupPracticeSuggestion)}</p>
              <p style="margin-bottom:0;"><strong>9. When to seek teacher help:</strong> ${item.teachingGuidance.teacherHelpIndicators.map(escapeHtml).join(' ')}</p>
            </div>`;
      return `
        <article style="border:1px solid #D5E8FA;border-radius:12px;padding:16px;margin-bottom:16px;page-break-inside:avoid;">
          <div style="font-size:12px;color:#476481;">
            Q${idx + 1} · ID ${escapeHtml(item.questionId)} (v${item.questionVersion}) · ${escapeHtml(item.subjectName)} / ${escapeHtml(item.topicName)} / ${escapeHtml(item.subtopicName)} · ${escapeHtml(item.difficulty)} · Marks: ${item.awardedMarks}/${item.maxMarks} · Status: <strong>${escapeHtml(statusText)}</strong>
          </div>
          <h3 style="margin:8px 0 4px 0;">${escapeHtml(item.questionEn)}</h3>
          <p style="margin:0 0 8px 0;color:#476481;">${escapeHtml(item.questionSi)}</p>
          ${imgBlock}
          <p><strong>Student Answer:</strong> ${escapeHtml(item.studentAnswerDisplay)} &nbsp;|&nbsp; <strong>Correct Answer:</strong> ${escapeHtml(item.correctAnswerDisplay)}</p>
          <p><strong>Explanation:</strong> ${escapeHtml(item.stepByStepExplanation)}</p>
          <p><strong>Memory Hint:</strong> ${escapeHtml(item.hint || item.memoryTrickBody)}</p>
          ${guidanceHtml}
        </article>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>MAN 5HE Parent Learning Report — ${escapeHtml(report.studentName)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #0F2942; max-width: 900px; margin: 24px auto; padding: 0 16px; line-height: 1.5; }
    header { border-bottom: 2px solid #158EE3; padding-bottom: 12px; margin-bottom: 20px; }
    .meta { color: #476481; font-size: 13px; }
  </style>
</head>
<body>
  <header>
    <h1>MAN 5HE Parent Learning Intelligence Report</h1>
    <div class="meta">Student: ${escapeHtml(report.studentName)} (${escapeHtml(report.studentUserIdCode)}) · Assessment: ${escapeHtml(report.assessmentTitle)} · Score: ${report.scorePercent !== null ? `${report.scorePercent}%` : 'Pending Teacher Mark'} (${report.awardedMarks}/${report.maxMarks})</div>
  </header>
  <section>
    <h2>Performance Summary</h2>
    <p>${escapeHtml(report.parentSummary)}</p>
    <p><strong>Encouragement:</strong> ${escapeHtml(report.encouragementNote)}</p>
  </section>
  <section>
    <h2>Question-by-Question Teaching Guide (${report.items.length} Questions)</h2>
    ${questionBlocks}
  </section>
</body>
</html>`;
}

export function buildEmailTextAndHtml(params: {
  heading: string;
  subheading: string;
  paragraphs: string[];
  footerNote?: string;
  accentColor?: string;
}): { htmlBody: string; textBody: string } {
  const safeParagraphs = (params.paragraphs || []).map((p) => `<p style="margin:0 0 12px 0;">${escapeHtml(p)}</p>`).join('\n');
  const footerHtml = params.footerNote
    ? `<div style="margin-top:14px;padding:12px 14px;border-radius:10px;background:#F3F9FF;border:1px solid #D5E8FA;font-size:12px;color:#476481;">${escapeHtml(params.footerNote)}</div>`
    : '';
  const htmlBody = renderMan5heEmailShell({
    title: escapeHtml(params.heading),
    subtitle: escapeHtml(params.subheading),
    accentColor: params.accentColor || '#158EE3',
    bodyHtml: `${safeParagraphs}${footerHtml}`,
  });

  const textBody = [
    params.heading,
    params.subheading,
    '',
    ...(params.paragraphs || []),
    ...(params.footerNote ? ['', params.footerNote] : []),
  ].join('\n');

  return { htmlBody, textBody };
}
