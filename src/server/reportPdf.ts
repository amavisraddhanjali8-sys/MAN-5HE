import type { ParentAssessmentReport } from '../lib/types.ts';

function toPdfAscii(text: string): string {
  // PDF Type1 Helvetica supports WinAnsi/ASCII; replace non-ASCII scripts cleanly with transliterated note where needed
  const clean = String(text || '')
    .replace(/\r?\n/g, ' ')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapLine(text: string, maxChars = 88): string[] {
  const safe = String(text || '').replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!safe) return [];
  const words = safe.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if (!current) {
      current = w;
    } else if (current.length + 1 + w.length <= maxChars) {
      current += ` ${w}`;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function buildParentReportPdfBuffer(report: ParentAssessmentReport): Buffer {
  const lines: { text: string; bold?: boolean; size?: number }[] = [
    { text: 'MAN 5HE - Parent Learning Intelligence Report', bold: true, size: 14 },
    {
      text: `Student: ${report.studentName} (${report.studentUserIdCode}) | Assessment: ${report.assessmentTitle}`,
      size: 10,
    },
    {
      text: `Result: ${report.scorePercent !== null ? `${report.scorePercent}%` : 'Pending Teacher Mark'} (${report.awardedMarks}/${report.maxMarks} marks) | Correct: ${report.correctCount} | Incorrect: ${report.incorrectCount} | Partial: ${report.partialCount} | Unanswered: ${report.unansweredCount}`,
      size: 10,
    },
    { text: '' },
  ];

  for (const l of wrapLine(`Summary: ${report.parentSummary}`, 88)) {
    lines.push({ text: l, size: 10 });
  }
  for (const l of wrapLine(`Encouragement: ${report.encouragementNote}`, 88)) {
    lines.push({ text: l, size: 10 });
  }
  lines.push({ text: '' });

  report.items.forEach((item, idx) => {
    lines.push({
      text: `Q${idx + 1} [${item.questionId} v${item.questionVersion}] ${item.subjectName} - ${item.topicName} (${item.difficulty}) [${item.correctnessStatus.toUpperCase()} ${item.awardedMarks}/${item.maxMarks}]`,
      bold: true,
      size: 10,
    });
    for (const l of wrapLine(`Question: ${item.questionEn}`, 86)) {
      lines.push({ text: l, size: 9 });
    }
    lines.push({
      text: `Student Answer: ${item.studentAnswerDisplay} | Correct Answer: ${item.correctAnswerDisplay}`,
      size: 9,
    });
    for (const l of wrapLine(`Explanation: ${item.stepByStepExplanation}`, 86)) {
      lines.push({ text: l, size: 9 });
    }
    if (item.correctnessStatus !== 'correct') {
      for (const l of wrapLine(`Parent Teaching Method: ${item.teachingGuidance.teachingMethod}`, 86)) {
        lines.push({ text: l, size: 9 });
      }
      for (const l of wrapLine(
        `Ask Child: ${item.teachingGuidance.questionsToAskChild[0] || ''} Follow-up: ${item.teachingGuidance.followupPracticeSuggestion}`,
        86
      )) {
        lines.push({ text: l, size: 9 });
      }
    }
    lines.push({ text: '' });
  });

  // Paginate lines (52 lines per US Letter / A4 portrait page)
  const linesPerPage = 48;
  const pages: typeof lines[] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }
  if (pages.length === 0) pages.push([{ text: 'Empty report', size: 10 }]);

  // Build PDF objects:
  // 1: Catalog, 2: Pages, 3: Font F1 (Helvetica), 4: Font F2 (Helvetica-Bold)
  // Then for each page p: Content object (5 + 2*p), Page object (6 + 2*p)
  const objects: string[] = [];
  const pageIds: number[] = [];

  for (let p = 0; p < pages.length; p++) {
    const contentObjId = 5 + p * 2;
    const pageObjId = 6 + p * 2;
    pageIds.push(pageObjId);

    const streamOps: string[] = ['BT'];
    let y = 760;
    for (const ln of pages[p]) {
      const font = ln.bold ? '/F2' : '/F1';
      const sz = ln.size || 10;
      streamOps.push(`${font} ${sz} Tf 48 ${y} Td (${toPdfAscii(ln.text)}) Tj`);
      streamOps.push(`0 0 Td`);
      streamOps.push(`-48 ${-y} Td`);
      y -= sz + 4;
    }
    streamOps.push('ET');
    const streamStr = streamOps.join('\n');
    objects[contentObjId] = `${contentObjId} 0 obj\n<< /Length ${Buffer.byteLength(streamStr, 'utf8')} >>\nstream\n${streamStr}\nendstream\nendobj\n`;
    objects[pageObjId] = `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`;
  }

  objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  objects[2] = `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>\nendobj\n`;
  objects[3] = `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;
  objects[4] = `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  const totalObjs = 4 + pages.length * 2;
  for (let id = 1; id <= totalObjs; id++) {
    offsets[id] = Buffer.byteLength(pdf, 'utf8');
    pdf += objects[id];
  }
  const xrefPos = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= totalObjs; id++) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}
