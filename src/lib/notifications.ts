import type { AttemptRecord, InvoiceRecord, StudentTrajectory } from './types.ts';

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

