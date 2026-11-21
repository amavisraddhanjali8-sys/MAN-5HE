import type {
  KnowledgePublication,
  PublicationStatus,
  UserRole,
  ValidationChecklist,
} from './types.ts';

export const SUPPORTED_GRADES = [
  'Grade 3',
  'Grade 4',
  'Grade 5',
  'Grade 6',
  'All',
] as const;

export const DEFAULT_GRADE = 'Grade 5';

export const MAX_RESOURCE_BYTES = 5 * 1024 * 1024; // 5 MB

export const ALLOWED_UPLOAD_TYPES: Record<
  string,
  { resourceType: 'image' | 'pdf' | 'document' | 'worksheet'; mimes: string[] }
> = {
  png: { resourceType: 'image', mimes: ['image/png'] },
  jpg: { resourceType: 'image', mimes: ['image/jpeg'] },
  jpeg: { resourceType: 'image', mimes: ['image/jpeg'] },
  webp: { resourceType: 'image', mimes: ['image/webp'] },
  pdf: { resourceType: 'pdf', mimes: ['application/pdf'] },
  txt: { resourceType: 'document', mimes: ['text/plain'] },
  md: { resourceType: 'document', mimes: ['text/markdown', 'text/plain'] },
  docx: {
    resourceType: 'worksheet',
    mimes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/zip',
    ],
  },
};

export function createEmptyChecklist(defaultChecked = false): ValidationChecklist {
  return {
    factualAccuracy: defaultChecked,
    sourceReliability: defaultChecked,
    gradeSuitability: defaultChecked,
    curriculumRelevance: defaultChecked,
    languageClarity: defaultChecked,
    resourceSafety: defaultChecked,
    copyrightLicensing: defaultChecked,
    accessibility: defaultChecked,
    notes: '',
  };
}

export function isChecklistComplete(checklist?: Partial<ValidationChecklist> | null): boolean {
  if (!checklist) return false;
  return Boolean(
    checklist.factualAccuracy &&
      checklist.sourceReliability &&
      checklist.gradeSuitability &&
      checklist.curriculumRelevance &&
      checklist.languageClarity &&
      checklist.resourceSafety &&
      checklist.copyrightLicensing &&
      checklist.accessibility
  );
}

export function sanitizeFileName(rawName: string): string {
  const base = rawName.split(/[/\\]/).pop() || 'resource';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.slice(0, 100) || 'resource.bin';
}

function isPrivateOrBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  const ipv4Match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

export function validateExternalResourceUrl(
  rawUrl: string
): { valid: boolean; normalizedUrl?: string; reason?: string } {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return { valid: false, reason: 'URL cannot be empty.' };
  }
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('file:')
  ) {
    return { valid: false, reason: 'Unsafe URI scheme is not permitted.' };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, reason: 'Only http:// or https:// URLs are permitted.' };
    }
    if (isPrivateOrBlockedHost(parsed.hostname)) {
      return {
        valid: false,
        reason: 'Private network or loopback hosts are blocked for resource safety.',
      };
    }
    return { valid: true, normalizedUrl: parsed.toString() };
  } catch {
    return { valid: false, reason: 'Malformed external resource URL.' };
  }
}

export function validateUploadPayload(params: {
  fileName: string;
  mimeType: string;
  base64Data: string;
}): {
  valid: boolean;
  buffer?: Buffer;
  safeFileName?: string;
  extension?: string;
  resourceType?: 'image' | 'pdf' | 'document' | 'worksheet';
  reason?: string;
} {
  const safeName = sanitizeFileName(params.fileName);
  const ext = (safeName.split('.').pop() || '').toLowerCase();
  const spec = ALLOWED_UPLOAD_TYPES[ext];
  if (!spec) {
    return {
      valid: false,
      reason: `Unsupported file type ".${ext}". Allowed: PNG, JPG, WEBP, PDF, TXT, MD, DOCX.`,
    };
  }

  const cleanMime = String(params.mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (cleanMime && !spec.mimes.includes(cleanMime)) {
    return {
      valid: false,
      reason: `MIME type "${cleanMime}" does not match ".${ext}".`,
    };
  }

  const rawBase64 = String(params.base64Data || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (!rawBase64) {
    return { valid: false, reason: 'Empty file payload.' };
  }

  const buf = Buffer.from(rawBase64, 'base64');
  if (buf.length === 0) {
    return { valid: false, reason: 'Uploaded file is empty.' };
  }
  if (buf.length > MAX_RESOURCE_BYTES) {
    return {
      valid: false,
      reason: `File exceeds the 5 MB security limit (${Math.round(buf.length / 1024)} KB).`,
    };
  }

  // Signature / magic byte & executable/script rejection
  const headAscii = buf.subarray(0, 256).toString('utf8').toLowerCase();
  if (
    headAscii.includes('<script') ||
    headAscii.includes('<!doctype html') ||
    headAscii.includes('<svg') ||
    (buf[0] === 0x4d && buf[1] === 0x5a) || // MZ PE executable
    (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) // ELF binary
  ) {
    return {
      valid: false,
      reason: 'File rejected by malware & active-script safety check.',
    };
  }

  if (ext === 'pdf' && !buf.subarray(0, 5).toString('ascii').startsWith('%PDF-')) {
    return { valid: false, reason: 'Invalid PDF header signature.' };
  }
  if (ext === 'png' && !(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) {
    return { valid: false, reason: 'Invalid PNG image header.' };
  }
  if ((ext === 'jpg' || ext === 'jpeg') && !(buf[0] === 0xff && buf[1] === 0xd8)) {
    return { valid: false, reason: 'Invalid JPEG image header.' };
  }
  if (
    ext === 'webp' &&
    !(
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    )
  ) {
    return { valid: false, reason: 'Invalid WEBP image header.' };
  }

  return {
    valid: true,
    buffer: buf,
    safeFileName: safeName,
    extension: ext,
    resourceType: spec.resourceType,
  };
}

export function isStudentEligibleForPublication(
  student: { grade?: string; active?: boolean },
  publication: Pick<KnowledgePublication, 'status' | 'targetGrades'>
): boolean {
  if (student.active === false) return false;
  if (publication.status !== 'PUBLISHED') return false;
  const studentGrade = student.grade || DEFAULT_GRADE;
  const targets = publication.targetGrades || [];
  return targets.includes('All') || targets.includes(studentGrade);
}

const VALID_TRANSITIONS: Record<PublicationStatus, PublicationStatus[]> = {
  DRAFT: ['PENDING_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'],
  PENDING_REVIEW: ['APPROVED', 'SCHEDULED', 'PUBLISHED', 'REJECTED', 'DRAFT', 'ARCHIVED'],
  REJECTED: ['DRAFT', 'PENDING_REVIEW', 'ARCHIVED'],
  APPROVED: ['SCHEDULED', 'PUBLISHED', 'DRAFT', 'ARCHIVED'],
  SCHEDULED: ['PUBLISHED', 'APPROVED', 'DRAFT', 'WITHDRAWN'],
  PUBLISHED: ['ARCHIVED', 'WITHDRAWN'],
  ARCHIVED: ['DRAFT', 'PUBLISHED'],
  WITHDRAWN: ['ARCHIVED', 'DRAFT'],
};

export function validatePublicationTransition(params: {
  actorRole: UserRole;
  hasDelegatedPublish?: boolean;
  fromStatus: PublicationStatus;
  toStatus: PublicationStatus;
  checklist?: Partial<ValidationChecklist> | null;
  scheduledFor?: string | null;
}): { allowed: boolean; reason?: string } {
  const { actorRole, hasDelegatedPublish, fromStatus, toStatus, checklist, scheduledFor } = params;

  if (fromStatus === toStatus) {
    return { allowed: true };
  }

  const nextOptions = VALID_TRANSITIONS[fromStatus] || [];
  if (!nextOptions.includes(toStatus)) {
    return {
      allowed: false,
      reason: `Cannot transition publication directly from ${fromStatus} to ${toStatus}.`,
    };
  }

  if (actorRole === 'student') {
    return { allowed: false, reason: 'Students cannot modify publication states.' };
  }

  if (actorRole === 'teacher') {
    const teacherAllowedTargets: PublicationStatus[] = ['DRAFT', 'PENDING_REVIEW'];
    if (hasDelegatedPublish) {
      teacherAllowedTargets.push('PUBLISHED', 'SCHEDULED');
    }
    if (!teacherAllowedTargets.includes(toStatus)) {
      return {
        allowed: false,
        reason: `Teachers can submit drafts for review; administrator approval is required to set status ${toStatus}.`,
      };
    }
  }

  if (toStatus === 'APPROVED' || toStatus === 'SCHEDULED' || toStatus === 'PUBLISHED') {
    if (!isChecklistComplete(checklist)) {
      return {
        allowed: false,
        reason:
          'All 8 publication verification checklist items (factual accuracy, source reliability, grade suitability, curriculum relevance, language clarity, resource safety, copyright, accessibility) must be verified before approval or publishing.',
      };
    }
  }

  if (toStatus === 'SCHEDULED') {
    if (!scheduledFor || Number.isNaN(Date.parse(scheduledFor))) {
      return {
        allowed: false,
        reason: 'Provide a valid future scheduled publication timestamp.',
      };
    }
  }

  return { allowed: true };
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3)
  );
}

export function detectDuplicateKnowledgeTopics(
  candidateTitle: string,
  candidateSourceUrl: string | null | undefined,
  existing: Pick<KnowledgePublication, 'id' | 'title' | 'sourceUrl' | 'status'>[]
): { id: string; title: string; score: number }[] {
  const candTokens = tokenize(candidateTitle);
  const cleanUrl = (candidateSourceUrl || '').trim().toLowerCase().replace(/\/+$/, '');
  const matches: { id: string; title: string; score: number }[] = [];

  for (const pub of existing) {
    if (pub.status === 'WITHDRAWN') continue;
    const pubUrl = (pub.sourceUrl || '').trim().toLowerCase().replace(/\/+$/, '');
    if (cleanUrl && pubUrl && cleanUrl === pubUrl) {
      matches.push({ id: pub.id, title: pub.title, score: 1 });
      continue;
    }

    const pubTokens = tokenize(pub.title);
    if (candTokens.size === 0 || pubTokens.size === 0) continue;
    let intersection = 0;
    for (const tok of candTokens) {
      if (pubTokens.has(tok)) intersection++;
    }
    const union = candTokens.size + pubTokens.size - intersection;
    const jaccard = union > 0 ? intersection / union : 0;
    if (jaccard >= 0.4) {
      matches.push({ id: pub.id, title: pub.title, score: Math.round(jaccard * 100) / 100 });
    }
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}
