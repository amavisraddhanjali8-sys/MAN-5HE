import crypto from 'node:crypto';
import { canAccessSubject, resolveQuestionSubjectId } from '../lib/authorization.ts';
import { convertLocalDateTimeToUtcIso, isValidTimeZone } from '../lib/learningScheduler.ts';
import {
  analyzeMissionRemediationNeed,
  buildProgressiveDifficultyWeights,
  computeExplorerRankFromXp,
  computeMissionRewards,
  computeProgressiveQuestionCount,
  DEFAULT_ROADMAP_GROWTH_FORMULA,
  detectPrerequisiteCycles,
  evaluateLevelCompletionEligibility,
  splitQuestionCountAcrossMissions,
} from '../lib/roadmapEngine.ts';
import { SKILL_LABEL_MAP } from '../lib/routineEngine.ts';
import type {
  EducationalSkillCategory,
  GameRoadmapDetail,
  GameRoadmapRecord,
  MasteryCheckpointResultRecord,
  MissionAttemptRecord,
  QuizItem,
  RewardDefinition,
  RewardTransactionRecord,
  RoadmapAvailabilityIssue,
  RoadmapDifficultyWeights,
  RoadmapGrowthFormula,
  RoadmapLevel,
  RoadmapLevelStatus,
  RoadmapMission,
  RoadmapMissionCompletionResult,
  RoadmapMissionType,
  RoadmapProgressReport,
  RoadmapStage,
  RoadmapStatus,
  StudentGamificationDashboard,
  StudentLevelProgressRecord,
  StudentQuizView,
  StudentUnlockedRewardRecord,
  UserAccount,
} from '../lib/types.ts';
import { AcademicService, HttpError, rowToQuiz } from './academicService.ts';
import { ParentIntelligenceService } from './parentIntelligenceService.ts';
import { WellbeingService } from './wellbeingService.ts';

function parseJsonSafe<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export class GamifiedRoadmapService {
  private readonly academic: AcademicService;
  private readonly parentIntel: ParentIntelligenceService;
  private readonly wellbeing: WellbeingService;

  constructor(
    academic: AcademicService,
    parentIntel: ParentIntelligenceService,
    wellbeing: WellbeingService
  ) {
    this.academic = academic;
    this.parentIntel = parentIntel;
    this.wellbeing = wellbeing;
  }

  private get dbWrapper() {
    return this.academic.dbWrapper;
  }

  private get db() {
    return this.dbWrapper.db;
  }

  // =========================================================================
  // 1. ACCESS CONTROL & HYDRATION
  // =========================================================================

  private assertCanViewStudent(actor: UserAccount, studentId: string): void {
    if (actor.role === 'admin') return;
    if (actor.role === 'student') {
      if (actor.id !== studentId) throw new HttpError(403, 'Access denied to another student roadmap.');
      return;
    }
    if (actor.role === 'parent') {
      const link = this.db
        .prepare(
          `SELECT 1 FROM guardian_student_links
           WHERE guardian_user_id = ? AND student_user_id = ? AND verified = 1`
        )
        .get(actor.id, studentId);
      if (!link) throw new HttpError(403, 'Access denied: student is not linked to your guardian account.');
      return;
    }
    if (actor.role === 'teacher') return; // subject scoping checked per roadmap
    throw new HttpError(403, 'Unauthorized role.');
  }

  private assertTeacherOrAdminSubjectScope(actor: UserAccount, subjectIds: string[]): void {
    if (actor.role === 'admin') return;
    if (actor.role !== 'teacher') {
      throw new HttpError(403, 'Only authorized teachers or administrators can create or edit roadmaps.');
    }
    const ctx = this.academic.buildAuthContext(actor);
    if (subjectIds.length === 0) {
      throw new HttpError(403, 'Teachers must specify at least one assigned subject for a roadmap.');
    }
    for (const sId of subjectIds) {
      if (!canAccessSubject(ctx, sId)) {
        throw new HttpError(
          403,
          `Access denied: subject ${sId} is outside your assigned teacher permissions.`
        );
      }
    }
  }

  private assertCanViewRoadmap(actor: UserAccount, roadmap: GameRoadmapRecord): void {
    if (actor.role === 'admin') return;
    if (actor.role === 'student' || actor.role === 'parent') {
      if (roadmap.status !== 'PUBLISHED') {
        throw new HttpError(403, 'Only published learning roadmaps are visible to students and parents.');
      }
      return;
    }
    if (actor.role === 'teacher') {
      const ctx = this.academic.buildAuthContext(actor);
      const hasOverlap =
        roadmap.creatorUserId === actor.id ||
        roadmap.subjectIds.some((sId) => canAccessSubject(ctx, sId));
      if (!hasOverlap && roadmap.status !== 'PUBLISHED') {
        throw new HttpError(
          403,
          'Access denied: unpublished roadmap does not cover your assigned subjects.'
        );
      }
      return;
    }
    throw new HttpError(403, 'Unauthorized role.');
  }

  private hydrateRoadmapRow(row: Record<string, unknown>): GameRoadmapRecord {
    return {
      id: String(row.id),
      slug: String(row.slug),
      name: String(row.name),
      description: String(row.description || ''),
      grade: String(row.grade || 'Grade 5'),
      scopeType: String(row.scope_type || 'mixed') as 'subject' | 'mixed',
      subjectIds: parseJsonSafe<string[]>(row.subject_ids_json, []),
      themeKey: String(row.theme_key || 'island_quest'),
      bannerImageUrl: row.banner_image_url ? String(row.banner_image_url) : null,
      status: String(row.status) as RoadmapStatus,
      currentVersion: Number(row.current_version ?? 1),
      growthFormula: {
        ...DEFAULT_ROADMAP_GROWTH_FORMULA,
        ...parseJsonSafe<Partial<RoadmapGrowthFormula>>(row.growth_formula_json, {}),
      },
      wellbeingMaxSessionMinutes: Number(row.wellbeing_max_session_minutes ?? 30),
      creatorUserId: String(row.creator_user_id),
      creatorName: String(row.creator_name),
      creatorRole: String(row.creator_role) as UserAccount['role'],
      approvedByUserId: row.approved_by_user_id ? String(row.approved_by_user_id) : null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      publishedAt: row.published_at ? String(row.published_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private hydrateRewardRow(row: Record<string, unknown>): RewardDefinition {
    return {
      id: String(row.id),
      code: String(row.code),
      rewardType: String(row.reward_type) as RewardDefinition['rewardType'],
      title: String(row.title),
      description: String(row.description || ''),
      iconKey: String(row.icon_key || 'star'),
      cosmeticPreview: parseJsonSafe(row.cosmetic_preview_json, {}),
      milestoneRuleText: String(row.milestone_rule_text || ''),
      active: Number(row.active ?? 1) === 1,
    };
  }

  private getActiveBankQuizzesForGrade(grade = 'Grade 5'): QuizItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM questions
         WHERE approval_status = 'ACTIVE' AND (grade = ? OR grade IS NULL OR grade = '')
         ORDER BY created_at DESC`
      )
      .all(grade) as Record<string, unknown>[];
    return rows.map(rowToQuiz);
  }

  private selectQuestionsForMissionFromBank(params: {
    grade: string;
    subjectIds: string[];
    topicIds: string[];
    subtopicIds: string[];
    questionCount: number;
    difficultyDistribution: RoadmapDifficultyWeights;
    studentId?: string;
    preferMistakeTopics?: boolean;
  }): {
    selected: QuizItem[];
    availableExactCount: number;
    availableSubjectCount: number;
    shortfall: number;
    shortageNote: string | null;
  } {
    const allActive = this.getActiveBankQuizzesForGrade(params.grade);
    const subjSet = new Set(params.subjectIds || []);
    const topicSet = new Set(params.topicIds || []);
    const subtopicSet = new Set(params.subtopicIds || []);

    const subjectPool =
      subjSet.size > 0
        ? allActive.filter((q) => subjSet.has(resolveQuestionSubjectId(q)))
        : allActive;

    const topicPool =
      topicSet.size > 0
        ? subjectPool.filter((q) => Boolean(q.topicId && topicSet.has(q.topicId)))
        : subjectPool;

    const exactPool =
      subtopicSet.size > 0
        ? topicPool.filter((q) => Boolean(q.subtopicId && subtopicSet.has(q.subtopicId)))
        : topicPool;

    // Candidate scoring prioritizes exact topic match + desired difficulty + unmastered items
    const statsRows = params.studentId
      ? (this.db
          .prepare(
            `SELECT question_id, valid_attempts, incorrect_attempts, correct_attempts
             FROM student_question_stats WHERE student_id = ?`
          )
          .all(params.studentId) as {
          question_id: string;
          valid_attempts: number;
          incorrect_attempts: number;
          correct_attempts: number;
        }[])
      : [];
    const stuStatMap = new Map(statsRows.map((s) => [s.question_id, s]));

    // Target counts per tier
    const tiers: (keyof RoadmapDifficultyWeights)[] = ['Simple', 'Moderate', 'Challenging', 'Master'];
    const totalWeight = tiers.reduce((acc, t) => acc + Math.max(0, Number(params.difficultyDistribution[t] || 0)), 0);
    const tierTargets: Record<keyof RoadmapDifficultyWeights, number> = {
      Simple: 0,
      Moderate: 0,
      Challenging: 0,
      Master: 0,
    };
    if (totalWeight <= 0) {
      tierTargets.Moderate = params.questionCount;
    } else {
      let allocated = 0;
      const remainders: { tier: keyof RoadmapDifficultyWeights; rem: number }[] = [];
      for (const t of tiers) {
        const exact = (Math.max(0, Number(params.difficultyDistribution[t] || 0)) / totalWeight) * params.questionCount;
        const fl = Math.floor(exact);
        tierTargets[t] = fl;
        allocated += fl;
        remainders.push({ tier: t, rem: exact - fl });
      }
      remainders.sort((a, b) => b.rem - a.rem);
      let remNeeded = params.questionCount - allocated;
      let idx = 0;
      while (remNeeded > 0) {
        tierTargets[remainders[idx % remainders.length].tier]++;
        remNeeded--;
        idx++;
      }
    }

    const scoreCandidate = (q: QuizItem, preferredTopic: boolean): number => {
      const st = stuStatMap.get(q.id);
      let s = preferredTopic ? 100 : 10;
      if (!st || st.valid_attempts === 0) s += 25;
      else if (params.preferMistakeTopics && st.incorrect_attempts > 0) s += 40;
      else if (st.incorrect_attempts > st.correct_attempts) s += 20;
      return s;
    };

    const primaryPool = exactPool.length > 0 ? exactPool : topicPool.length > 0 ? topicPool : subjectPool;
    const secondaryPool = subjectPool.filter((q) => !primaryPool.some((p) => p.id === q.id));

    const chosen: QuizItem[] = [];
    const chosenIds = new Set<string>();

    const pickFromPool = (pool: QuizItem[], targetTier: keyof RoadmapDifficultyWeights | null, need: number, preferred: boolean) => {
      const candidates = pool
        .filter((q) => !chosenIds.has(q.id))
        .filter((q) => !targetTier || q.attributes.difficultyTier === targetTier)
        .sort((a, b) => scoreCandidate(b, preferred) - scoreCandidate(a, preferred));
      for (const c of candidates) {
        if (chosen.length >= params.questionCount || need <= 0) break;
        chosen.push(c);
        chosenIds.add(c.id);
        need--;
      }
      return need;
    };

    // Pass 1: exact difficulty tiers inside primaryPool
    for (const t of tiers) {
      if (tierTargets[t] > 0) {
        pickFromPool(primaryPool, t, tierTargets[t], true);
      }
    }
    // Pass 2: fill any remaining need from primaryPool regardless of difficulty
    if (chosen.length < params.questionCount) {
      pickFromPool(primaryPool, null, params.questionCount - chosen.length, true);
    }
    // Pass 3: fill remaining need from broader subjectPool without inventing fake questions
    if (chosen.length < params.questionCount) {
      pickFromPool(secondaryPool, null, params.questionCount - chosen.length, false);
    }

    const shortfall = Math.max(0, params.questionCount - chosen.length);
    let shortageNote: string | null = null;
    if (shortfall > 0) {
      shortageNote = `Requested ${params.questionCount} active question(s), but only ${chosen.length} approved question(s) are currently available in the matching bank scope.`;
    } else if (exactPool.length < params.questionCount && subjectPool.length >= params.questionCount) {
      shortageNote = `Only ${exactPool.length} exact topic match(es) found; supplemented with ${params.questionCount - exactPool.length} approved question(s) from the same subject scope.`;
    }

    return {
      selected: chosen,
      availableExactCount: exactPool.length,
      availableSubjectCount: subjectPool.length,
      shortfall,
      shortageNote,
    };
  }

  private ensureStudentEnrolled(studentId: string, roadmap: GameRoadmapRecord): void {
    const existing = this.db
      .prepare('SELECT id FROM student_roadmap_enrollments WHERE student_id = ? AND roadmap_id = ?')
      .get(studentId, roadmap.id);

    const levelRows = this.db
      .prepare(
        `SELECT * FROM roadmap_levels
         WHERE roadmap_id = ? AND version_number = ?
         ORDER BY sequence_order ASC`
      )
      .all(roadmap.id, roadmap.currentVersion) as Record<string, unknown>[];
    if (levelRows.length === 0) return;

    const prereqRows = this.db
      .prepare(
        `SELECT level_id, prerequisite_level_id FROM roadmap_level_prerequisites
         WHERE roadmap_id = ? AND version_number = ?`
      )
      .all(roadmap.id, roadmap.currentVersion) as { level_id: string; prerequisite_level_id: string }[];
    const prereqMap = new Map<string, string[]>();
    for (const p of prereqRows) {
      const list = prereqMap.get(p.level_id) || [];
      list.push(p.prerequisite_level_id);
      prereqMap.set(p.level_id, list);
    }

    const now = new Date().toISOString();
    let firstAvailableId = String(levelRows[0].id);

    this.dbWrapper.transaction(() => {
      for (const lvl of levelRows) {
        const lId = String(lvl.id);
        const existingProg = this.db
          .prepare('SELECT id, status FROM student_level_progress WHERE student_id = ? AND level_id = ?')
          .get(studentId, lId) as { id: string; status: RoadmapLevelStatus } | undefined;
        if (!existingProg) {
          const prereqs = prereqMap.get(lId) || [];
          const st: RoadmapLevelStatus = prereqs.length === 0 ? 'AVAILABLE' : 'LOCKED';
          if (st === 'AVAILABLE' && firstAvailableId === String(levelRows[0].id)) {
            firstAvailableId = lId;
          }
          this.db
            .prepare(
              `INSERT OR IGNORE INTO student_level_progress (
                id, student_id, roadmap_id, level_id, status, best_accuracy_percent,
                missions_completed_count, checkpoint_passed, objectives_covered_json, unlocked_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, '[]', ?, ?)`
            )
            .run(`SLP-${studentId}-${lId}`, studentId, roadmap.id, lId, st, st === 'AVAILABLE' ? now : null, now);
        }
      }

      if (!existing) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO student_roadmap_enrollments (
              id, student_id, roadmap_id, enrolled_at, current_level_id, status, adaptive_remediation_enabled
            ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', 1)`
          )
          .run(`SRE-${studentId}-${roadmap.id}`, studentId, roadmap.id, now, firstAvailableId);
      }
    });
  }

  // =========================================================================
  // 2. ROADMAP QUERIES & DETAIL HYDRATION
  // =========================================================================

  public listRoadmaps(actor: UserAccount): GameRoadmapDetail[] {
    const rows = this.db
      .prepare('SELECT * FROM game_roadmaps ORDER BY updated_at DESC, created_at DESC')
      .all() as Record<string, unknown>[];
    const records = rows.map((r) => this.hydrateRoadmapRow(r));
    const visible = records.filter((rm) => {
      if (actor.role === 'admin') return true;
      if (actor.role === 'student' || actor.role === 'parent') return rm.status === 'PUBLISHED';
      if (actor.role === 'teacher') {
        const ctx = this.academic.buildAuthContext(actor);
        return (
          rm.status === 'PUBLISHED' ||
          rm.creatorUserId === actor.id ||
          rm.subjectIds.some((sId) => canAccessSubject(ctx, sId))
        );
      }
      return false;
    });

    const studentTarget = actor.role === 'student' ? actor.id : undefined;
    return visible.map((rm) => this.getRoadmapDetail(actor, rm.id, studentTarget));
  }

  public getRoadmapDetail(
    actor: UserAccount,
    roadmapId: string,
    studentId?: string
  ): GameRoadmapDetail {
    const row = this.db
      .prepare('SELECT * FROM game_roadmaps WHERE id = ?')
      .get(roadmapId) as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, 'Roadmap not found.');
    const roadmap = this.hydrateRoadmapRow(row);
    this.assertCanViewRoadmap(actor, roadmap);

    const targetStudentId =
      actor.role === 'student'
        ? actor.id
        : studentId
        ? (() => {
            this.assertCanViewStudent(actor, studentId);
            return studentId;
          })()
        : null;

    if (targetStudentId && roadmap.status === 'PUBLISHED') {
      this.ensureStudentEnrolled(targetStudentId, roadmap);
    }

    const stagesRows = this.db
      .prepare(
        `SELECT * FROM roadmap_stages
         WHERE roadmap_id = ? AND version_number = ?
         ORDER BY sort_order ASC`
      )
      .all(roadmap.id, roadmap.currentVersion) as Record<string, unknown>[];
    const stages: RoadmapStage[] = stagesRows.map((s) => ({
      id: String(s.id),
      roadmapId: String(s.roadmap_id),
      versionNumber: Number(s.version_number),
      sortOrder: Number(s.sort_order),
      title: String(s.title),
      description: String(s.description || ''),
      themeColor: String(s.theme_color || '#158EE3'),
      milestoneRewardBadgeId: s.milestone_reward_badge_id ? String(s.milestone_reward_badge_id) : null,
      createdAt: String(s.created_at),
    }));

    const prereqRows = this.db
      .prepare(
        `SELECT level_id, prerequisite_level_id FROM roadmap_level_prerequisites
         WHERE roadmap_id = ? AND version_number = ?`
      )
      .all(roadmap.id, roadmap.currentVersion) as { level_id: string; prerequisite_level_id: string }[];
    const prereqMap = new Map<string, string[]>();
    for (const pr of prereqRows) {
      const list = prereqMap.get(pr.level_id) || [];
      list.push(pr.prerequisite_level_id);
      prereqMap.set(pr.level_id, list);
    }

    const levelRows = this.db
      .prepare(
        `SELECT * FROM roadmap_levels
         WHERE roadmap_id = ? AND version_number = ?
         ORDER BY sequence_order ASC`
      )
      .all(roadmap.id, roadmap.currentVersion) as Record<string, unknown>[];
    const levels: RoadmapLevel[] = levelRows.map((l) => ({
      id: String(l.id),
      roadmapId: String(l.roadmap_id),
      versionNumber: Number(l.version_number),
      stageId: String(l.stage_id),
      sequenceOrder: Number(l.sequence_order),
      title: String(l.title),
      description: String(l.description || ''),
      academicObjectives: parseJsonSafe<string[]>(l.academic_objectives_json, []),
      subjectIds: parseJsonSafe<string[]>(l.subject_ids_json, []),
      topicIds: parseJsonSafe<string[]>(l.topic_ids_json, []),
      subtopicIds: parseJsonSafe<string[]>(l.subtopic_ids_json, []),
      targetQuestionCount: Number(l.target_question_count ?? 4),
      maxQuestionCount: Number(l.max_question_count ?? 20),
      difficultyDistribution: parseJsonSafe<RoadmapDifficultyWeights>(l.difficulty_distribution_json, {
        Simple: 40,
        Moderate: 40,
        Challenging: 20,
        Master: 0,
      }),
      minMasteryAccuracyPercent: Number(l.min_mastery_accuracy_percent ?? 60),
      requiredMissionsCount: Number(l.required_missions_count ?? 1),
      hasCheckpoint: Number(l.has_checkpoint ?? 0) === 1,
      specialUnlockNote: l.special_unlock_note ? String(l.special_unlock_note) : null,
      xpReward: Number(l.xp_reward ?? 40),
      starsReward: Number(l.stars_reward ?? 3),
      coinsReward: Number(l.coins_reward ?? 15),
      unlockCosmeticId: l.unlock_cosmetic_id ? String(l.unlock_cosmetic_id) : null,
      prerequisiteLevelIds: prereqMap.get(String(l.id)) || [],
    }));

    const missionRows = this.db
      .prepare(
        `SELECT m.*, c.puzzle_hint_mode, c.allow_retry, c.max_attempts_per_day
         FROM roadmap_missions m
         LEFT JOIN roadmap_mission_configs c ON c.mission_id = m.id
         WHERE m.roadmap_id = ? AND m.version_number = ?
         ORDER BY m.sort_order ASC`
      )
      .all(roadmap.id, roadmap.currentVersion) as Record<string, unknown>[];
    const missions: RoadmapMission[] = missionRows.map((m) => ({
      id: String(m.id),
      roadmapId: String(m.roadmap_id),
      versionNumber: Number(m.version_number),
      levelId: String(m.level_id),
      sortOrder: Number(m.sort_order),
      title: String(m.title),
      description: String(m.description || ''),
      missionType: String(m.mission_type) as RoadmapMissionType,
      subjectIds: parseJsonSafe<string[]>(m.subject_ids_json, []),
      topicIds: parseJsonSafe<string[]>(m.topic_ids_json, []),
      subtopicIds: parseJsonSafe<string[]>(m.subtopic_ids_json, []),
      questionCount: Number(m.question_count ?? 4),
      difficultyDistribution: parseJsonSafe<RoadmapDifficultyWeights>(m.difficulty_distribution_json, {
        Simple: 50,
        Moderate: 50,
        Challenging: 0,
        Master: 0,
      }),
      timeLimitSeconds:
        m.time_limit_seconds === null || m.time_limit_seconds === undefined
          ? null
          : Number(m.time_limit_seconds),
      isRequired: Number(m.is_required ?? 1) === 1,
      isRemedial: Number(m.is_remedial ?? 0) === 1,
      minPassAccuracyPercent: Number(m.min_pass_accuracy_percent ?? 60),
      xpReward: Number(m.xp_reward ?? 25),
      starsReward: Number(m.stars_reward ?? 2),
      coinsReward: Number(m.coins_reward ?? 10),
      allowRetry: Number(m.allow_retry ?? 1) === 1,
      puzzleHintMode: Number(m.puzzle_hint_mode ?? 0) === 1,
      maxAttemptsPerDay: Number(m.max_attempts_per_day ?? 8),
    }));

    // Real Question Bank Availability Audit (never auto-creates dummy questions)
    const availabilityIssues: RoadmapAvailabilityIssue[] = [];
    for (const lvl of levels) {
      const lvlMissions = missions.filter((m) => m.levelId === lvl.id);
      if (lvlMissions.length === 0) {
        availabilityIssues.push({
          levelId: lvl.id,
          levelTitle: lvl.title,
          requestedCount: lvl.targetQuestionCount,
          availableCount: 0,
          message: `Level "${lvl.title}" currently has no configured missions.`,
        });
      }
      for (const m of lvlMissions) {
        const check = this.selectQuestionsForMissionFromBank({
          grade: roadmap.grade,
          subjectIds: m.subjectIds.length > 0 ? m.subjectIds : lvl.subjectIds,
          topicIds: m.topicIds,
          subtopicIds: m.subtopicIds,
          questionCount: m.questionCount,
          difficultyDistribution: m.difficultyDistribution,
        });
        if (check.shortfall > 0) {
          availabilityIssues.push({
            levelId: lvl.id,
            levelTitle: lvl.title,
            missionId: m.id,
            missionTitle: m.title,
            requestedCount: m.questionCount,
            availableCount: check.selected.length,
            message: `${lvl.title} -> "${m.title}": requested ${m.questionCount} approved questions, found ${check.selected.length} in bank scope.`,
          });
        }
      }
    }

    const verRows = this.db
      .prepare(
        `SELECT version_number, title, change_note, created_at
         FROM roadmap_versions WHERE roadmap_id = ? ORDER BY version_number DESC`
      )
      .all(roadmap.id) as { version_number: number; title: string; change_note: string; created_at: string }[];

    let studentProgress: GameRoadmapDetail['studentProgress'];
    if (targetStudentId) {
      const enr = this.db
        .prepare('SELECT * FROM student_roadmap_enrollments WHERE student_id = ? AND roadmap_id = ?')
        .get(targetStudentId, roadmap.id) as Record<string, unknown> | undefined;

      const progRows = this.db
        .prepare(
          `SELECT * FROM student_level_progress
           WHERE student_id = ? AND roadmap_id = ?`
        )
        .all(targetStudentId, roadmap.id) as Record<string, unknown>[];
      const levelProgress: StudentLevelProgressRecord[] = progRows.map((p) => ({
        id: String(p.id),
        studentId: String(p.student_id),
        roadmapId: String(p.roadmap_id),
        levelId: String(p.level_id),
        status: String(p.status) as RoadmapLevelStatus,
        bestAccuracyPercent: Number(p.best_accuracy_percent ?? 0),
        missionsCompletedCount: Number(p.missions_completed_count ?? 0),
        checkpointPassed: Number(p.checkpoint_passed ?? 0) === 1,
        objectivesCovered: parseJsonSafe<string[]>(p.objectives_covered_json, []),
        unlockedAt: p.unlocked_at ? String(p.unlocked_at) : null,
        completedAt: p.completed_at ? String(p.completed_at) : null,
        updatedAt: String(p.updated_at),
      }));

      const attRows = this.db
        .prepare(
          `SELECT * FROM mission_attempts
           WHERE student_id = ? AND roadmap_id = ?
           ORDER BY started_at DESC LIMIT 30`
        )
        .all(targetStudentId, roadmap.id) as Record<string, unknown>[];
      const recentAttempts: MissionAttemptRecord[] = attRows.map((a) => this.hydrateMissionAttemptRow(a));

      // Topic name lookup for remediation guidance
      const topicNameRows = this.db.prepare('SELECT id, name_en FROM topics').all() as {
        id: string;
        name_en: string;
      }[];
      const topicNameMap = new Map(topicNameRows.map((t) => [t.id, t.name_en]));

      const ckptRows = this.db
        .prepare(
          `SELECT * FROM mastery_checkpoint_results
           WHERE student_id = ? AND roadmap_id = ? AND remediation_recommended = 1
           ORDER BY created_at DESC LIMIT 10`
        )
        .all(targetStudentId, roadmap.id) as Record<string, unknown>[];

      const seenLevels = new Set<string>();
      const adaptiveRecommendations: NonNullable<GameRoadmapDetail['studentProgress']>['adaptiveRecommendations'] = [];
      for (const ck of ckptRows) {
        const lId = String(ck.level_id);
        if (seenLevels.has(lId)) continue;
        const lp = levelProgress.find((p) => p.levelId === lId);
        if (lp?.checkpointPassed || lp?.status === 'COMPLETED') continue;
        seenLevels.add(lId);
        const weakIds = parseJsonSafe<string[]>(ck.weak_topic_ids_json, []);
        const remedialMission = missions.find((m) => m.levelId === lId && m.isRemedial);
        adaptiveRecommendations.push({
          levelId: lId,
          weakTopicIds: weakIds,
          weakTopicNames: weakIds.map((id) => topicNameMap.get(id) || id),
          suggestedMissionId: remedialMission?.id || null,
          explanation: String(ck.feedback_note || ''),
        });
      }

      studentProgress = {
        enrolled: Boolean(enr),
        currentLevelId: enr?.current_level_id ? String(enr.current_level_id) : levels[0]?.id || null,
        levelProgress,
        recentAttempts,
        adaptiveRecommendations,
      };
    }

    return {
      roadmap,
      stages,
      levels,
      missions,
      availabilityIssues,
      versions: verRows.map((v) => ({
        versionNumber: Number(v.version_number),
        title: String(v.title),
        changeNote: String(v.change_note || ''),
        createdAt: String(v.created_at),
      })),
      studentProgress,
    };
  }

  private hydrateMissionAttemptRow(a: Record<string, unknown>): MissionAttemptRecord {
    return {
      id: String(a.id),
      studentId: String(a.student_id),
      roadmapId: String(a.roadmap_id),
      levelId: String(a.level_id),
      missionId: String(a.mission_id),
      questionSnapshotIds: parseJsonSafe<string[]>(a.question_snapshot_ids_json, []),
      startedAt: String(a.started_at),
      completedAt: a.completed_at ? String(a.completed_at) : null,
      durationSeconds: Number(a.duration_seconds ?? 0),
      observedActiveSeconds: Number(a.observed_active_seconds ?? 0),
      totalQuestions: Number(a.total_questions ?? 0),
      correctCount: Number(a.correct_count ?? 0),
      accuracyPercent: a.accuracy_percent === null || a.accuracy_percent === undefined ? null : Number(a.accuracy_percent),
      masteryPassed: Number(a.mastery_passed ?? 0) === 1,
      rewardGranted: Number(a.reward_granted ?? 0) === 1,
      idempotencyKey: String(a.idempotency_key),
    };
  }

  // =========================================================================
  // 3. ROADMAP AUTHORING, STAGES, LEVELS, MISSIONS & WORKFLOW
  // =========================================================================

  public createRoadmap(
    actor: UserAccount,
    payload: {
      name: string;
      description?: string;
      grade?: string;
      scopeType?: 'subject' | 'mixed';
      subjectIds: string[];
      themeKey?: string;
      bannerImageUrl?: string | null;
      growthFormula?: Partial<RoadmapGrowthFormula>;
      wellbeingMaxSessionMinutes?: number;
      initialStageTitle?: string;
    }
  ): GameRoadmapDetail {
    const cleanName = String(payload.name || '').trim();
    if (!cleanName) throw new HttpError(400, 'Roadmap name is required.');
    const subjectIds = Array.from(new Set((payload.subjectIds || []).map(String).filter(Boolean)));
    if (subjectIds.length === 0) throw new HttpError(400, 'At least one subjectId is required.');

    this.assertTeacherOrAdminSubjectScope(actor, subjectIds);

    const grade = String(payload.grade || 'Grade 5').trim() || 'Grade 5';
    const wbRule = this.wellbeing.getActiveRuleForGrade(grade);
    const requestedMaxMin = Number(
      payload.wellbeingMaxSessionMinutes || payload.growthFormula?.maxSessionDurationMinutes || 25
    );
    const clampedMaxMin = Math.max(
      10,
      Math.min(wbRule.continuousSessionWarningMinutes, Math.round(requestedMaxMin))
    );

    const formula: RoadmapGrowthFormula = {
      ...DEFAULT_ROADMAP_GROWTH_FORMULA,
      ...(payload.growthFormula || {}),
      maxSessionDurationMinutes: clampedMaxMin,
    };

    const id = `RMAP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const slugBase = cleanName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
    const slug = `${slugBase || 'quest'}-${id.slice(-4).toLowerCase()}`;
    const now = new Date().toISOString();
    const status: RoadmapStatus = actor.role === 'admin' ? 'DRAFT' : 'DRAFT';

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO game_roadmaps (
            id, slug, name, description, grade, scope_type, subject_ids_json, theme_key,
            banner_image_url, status, current_version, growth_formula_json, wellbeing_max_session_minutes,
            creator_user_id, creator_name, creator_role, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          slug,
          cleanName,
          String(payload.description || '').trim(),
          grade,
          subjectIds.length === 1 ? 'subject' : payload.scopeType || 'mixed',
          JSON.stringify(subjectIds),
          String(payload.themeKey || 'island_quest'),
          payload.bannerImageUrl || null,
          status,
          JSON.stringify(formula),
          clampedMaxMin,
          actor.id,
          actor.name,
          actor.role,
          now,
          now
        );

      this.db
        .prepare(
          `INSERT INTO roadmap_versions (
            id, roadmap_id, version_number, title, description, growth_formula_json,
            wellbeing_max_session_minutes, change_note, created_by_user_id, created_at
          ) VALUES (?, ?, 1, ?, ?, ?, ?, 'Initial roadmap draft', ?, ?)`
        )
        .run(
          `RMV-${id}-1`,
          id,
          cleanName,
          String(payload.description || '').trim(),
          JSON.stringify(formula),
          clampedMaxMin,
          actor.id,
          now
        );

      const stageId = `RSTG-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      this.db
        .prepare(
          `INSERT INTO roadmap_stages (
            id, roadmap_id, version_number, sort_order, title, description, theme_color, created_at
          ) VALUES (?, ?, 1, 1, ?, ?, '#158EE3', ?)`
        )
        .run(
          stageId,
          id,
          String(payload.initialStageTitle || 'Stage 1: Discovery Trail').trim(),
          'Foundational learning stage introducing core concepts calmly.',
          now
        );

      this.writeGamificationAudit({
        roadmapId: id,
        actor,
        eventType: 'ROADMAP_CREATED',
        summary: `Created learning roadmap "${cleanName}" (${grade}).`,
        details: { subjectIds, formula, wellbeingMaxSessionMinutes: clampedMaxMin },
      });
    });

    return this.getRoadmapDetail(actor, id);
  }

  public createStage(
    actor: UserAccount,
    roadmapId: string,
    payload: {
      title: string;
      description?: string;
      sortOrder?: number;
      themeColor?: string;
      milestoneRewardBadgeId?: string | null;
    }
  ): RoadmapStage {
    const rmRow = this.db.prepare('SELECT * FROM game_roadmaps WHERE id = ?').get(roadmapId) as
      | Record<string, unknown>
      | undefined;
    if (!rmRow) throw new HttpError(404, 'Roadmap not found.');
    const rm = this.hydrateRoadmapRow(rmRow);
    this.assertTeacherOrAdminSubjectScope(actor, rm.subjectIds);

    const cleanTitle = String(payload.title || '').trim();
    if (!cleanTitle) throw new HttpError(400, 'Stage title is required.');

    const existingCount = (
      this.db
        .prepare('SELECT COUNT(*) as cnt FROM roadmap_stages WHERE roadmap_id = ? AND version_number = ?')
        .get(roadmapId, rm.currentVersion) as { cnt: number }
    ).cnt;
    const stageId = `RSTG-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    const sortOrder = payload.sortOrder ? Math.max(1, Math.round(payload.sortOrder)) : existingCount + 1;

    this.db
      .prepare(
        `INSERT INTO roadmap_stages (
          id, roadmap_id, version_number, sort_order, title, description, theme_color, milestone_reward_badge_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        stageId,
        roadmapId,
        rm.currentVersion,
        sortOrder,
        cleanTitle,
        String(payload.description || '').trim(),
        String(payload.themeColor || '#158EE3'),
        payload.milestoneRewardBadgeId || null,
        now
      );

    this.db.prepare('UPDATE game_roadmaps SET updated_at = ? WHERE id = ?').run(now, roadmapId);

    return {
      id: stageId,
      roadmapId,
      versionNumber: rm.currentVersion,
      sortOrder,
      title: cleanTitle,
      description: String(payload.description || '').trim(),
      themeColor: String(payload.themeColor || '#158EE3'),
      milestoneRewardBadgeId: payload.milestoneRewardBadgeId || null,
      createdAt: now,
    };
  }

  public upsertLevel(
    actor: UserAccount,
    roadmapId: string,
    payload: {
      id?: string;
      stageId: string;
      sequenceOrder?: number;
      title: string;
      description?: string;
      academicObjectives?: string[];
      subjectIds?: string[];
      topicIds?: string[];
      subtopicIds?: string[];
      explicitQuestionCount?: number | null;
      maxQuestionCount?: number | null;
      difficultyDistribution?: RoadmapDifficultyWeights;
      minMasteryAccuracyPercent?: number;
      requiredMissionsCount?: number;
      hasCheckpoint?: boolean;
      specialUnlockNote?: string | null;
      xpReward?: number;
      starsReward?: number;
      coinsReward?: number;
      unlockCosmeticId?: string | null;
      prerequisiteLevelIds?: string[];
      autoGenerateMissions?: boolean;
    }
  ): GameRoadmapDetail {
    const rmRow = this.db.prepare('SELECT * FROM game_roadmaps WHERE id = ?').get(roadmapId) as
      | Record<string, unknown>
      | undefined;
    if (!rmRow) throw new HttpError(404, 'Roadmap not found.');
    const rm = this.hydrateRoadmapRow(rmRow);

    const subjectIds =
      payload.subjectIds && payload.subjectIds.length > 0 ? payload.subjectIds : rm.subjectIds;
    this.assertTeacherOrAdminSubjectScope(actor, [...rm.subjectIds, ...subjectIds]);

    const stageExists = this.db
      .prepare('SELECT 1 FROM roadmap_stages WHERE id = ? AND roadmap_id = ? AND version_number = ?')
      .get(payload.stageId, roadmapId, rm.currentVersion);
    if (!stageExists) throw new HttpError(400, 'Target stage does not exist in this roadmap.');

    const cleanTitle = String(payload.title || '').trim();
    if (!cleanTitle) throw new HttpError(400, 'Level title is required.');

    const existingLevels = this.db
      .prepare('SELECT id, sequence_order FROM roadmap_levels WHERE roadmap_id = ? AND version_number = ?')
      .all(roadmapId, rm.currentVersion) as { id: string; sequence_order: number }[];
    const levelId = payload.id || `RLVL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const seqOrder = payload.sequenceOrder
      ? Math.max(1, Math.round(payload.sequenceOrder))
      : existingLevels.length + 1;

    // Prerequisite cycle validation across all levels in roadmap version
    const prereqIds = Array.from(new Set((payload.prerequisiteLevelIds || []).map(String).filter(Boolean)));
    for (const pId of prereqIds) {
      if (!existingLevels.some((el) => el.id === pId) && pId !== levelId) {
        throw new HttpError(400, `Prerequisite level ${pId} does not exist in this roadmap.`);
      }
    }
    const existingPrereqs = this.db
      .prepare('SELECT level_id, prerequisite_level_id FROM roadmap_level_prerequisites WHERE roadmap_id = ? AND version_number = ?')
      .all(roadmapId, rm.currentVersion) as { level_id: string; prerequisite_level_id: string }[];
    const graphMap = new Map<string, string[]>();
    for (const el of existingLevels) graphMap.set(el.id, []);
    for (const pr of existingPrereqs) {
      const list = graphMap.get(pr.level_id) || [];
      list.push(pr.prerequisite_level_id);
      graphMap.set(pr.level_id, list);
    }
    graphMap.set(levelId, prereqIds);
    const cycles = detectPrerequisiteCycles(
      Array.from(graphMap.entries()).map(([id, prerequisiteLevelIds]) => ({ id, prerequisiteLevelIds }))
    );
    if (cycles.length > 0) {
      throw new HttpError(400, `Invalid level prerequisites: ${cycles[0]}`);
    }

    const totalLevelsAfter = existingLevels.some((l) => l.id === levelId)
      ? existingLevels.length
      : existingLevels.length + 1;
    const computedQuestionCount = computeProgressiveQuestionCount({
      sequenceOrder: seqOrder,
      explicitTargetCount: payload.explicitQuestionCount,
      formula: rm.growthFormula,
      levelMaxOverride: payload.maxQuestionCount,
    });
    const difficultyDist =
      payload.difficultyDistribution || buildProgressiveDifficultyWeights(seqOrder, Math.max(4, totalLevelsAfter));

    const now = new Date().toISOString();
    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO roadmap_levels (
            id, roadmap_id, version_number, stage_id, sequence_order, title, description,
            academic_objectives_json, subject_ids_json, topic_ids_json, subtopic_ids_json,
            target_question_count, max_question_count, difficulty_distribution_json,
            min_mastery_accuracy_percent, required_missions_count, has_checkpoint,
            special_unlock_note, xp_reward, stars_reward, coins_reward, unlock_cosmetic_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            stage_id = excluded.stage_id,
            sequence_order = excluded.sequence_order,
            title = excluded.title,
            description = excluded.description,
            academic_objectives_json = excluded.academic_objectives_json,
            subject_ids_json = excluded.subject_ids_json,
            topic_ids_json = excluded.topic_ids_json,
            subtopic_ids_json = excluded.subtopic_ids_json,
            target_question_count = excluded.target_question_count,
            max_question_count = excluded.max_question_count,
            difficulty_distribution_json = excluded.difficulty_distribution_json,
            min_mastery_accuracy_percent = excluded.min_mastery_accuracy_percent,
            required_missions_count = excluded.required_missions_count,
            has_checkpoint = excluded.has_checkpoint,
            special_unlock_note = excluded.special_unlock_note,
            xp_reward = excluded.xp_reward,
            stars_reward = excluded.stars_reward,
            coins_reward = excluded.coins_reward,
            unlock_cosmetic_id = excluded.unlock_cosmetic_id`
        )
        .run(
          levelId,
          roadmapId,
          rm.currentVersion,
          payload.stageId,
          seqOrder,
          cleanTitle,
          String(payload.description || '').trim(),
          JSON.stringify(payload.academicObjectives || []),
          JSON.stringify(subjectIds),
          JSON.stringify(payload.topicIds || []),
          JSON.stringify(payload.subtopicIds || []),
          computedQuestionCount,
          Number(payload.maxQuestionCount || rm.growthFormula.maxQuestionCount || 20),
          JSON.stringify(difficultyDist),
          Math.max(40, Math.min(95, Number(payload.minMasteryAccuracyPercent || 65))),
          Math.max(1, Number(payload.requiredMissionsCount || 1)),
          payload.hasCheckpoint ? 1 : 0,
          payload.specialUnlockNote || null,
          Math.max(10, Number(payload.xpReward || 30 + seqOrder * 10)),
          Math.max(1, Number(payload.starsReward || 3)),
          Math.max(5, Number(payload.coinsReward || 10 + seqOrder * 5)),
          payload.unlockCosmeticId || null
        );

      this.db
        .prepare('DELETE FROM roadmap_level_prerequisites WHERE level_id = ?')
        .run(levelId);
      for (const pId of prereqIds) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO roadmap_level_prerequisites (
              id, roadmap_id, version_number, level_id, prerequisite_level_id
            ) VALUES (?, ?, ?, ?, ?)`
          )
          .run(`RLP-${crypto.randomBytes(4).toString('hex')}`, roadmapId, rm.currentVersion, levelId, pId);
      }

      if (payload.autoGenerateMissions) {
        const existingMissions = this.db
          .prepare('SELECT COUNT(*) as cnt FROM roadmap_missions WHERE level_id = ?')
          .get(levelId) as { cnt: number };
        if (existingMissions.cnt === 0) {
          const splits = splitQuestionCountAcrossMissions(
            computedQuestionCount,
            rm.growthFormula.maxQuestionsPerMission || 6
          );
          splits.forEach((cnt, idx) => {
            const mId = `RMIS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
            const isCkpt = payload.hasCheckpoint && idx === splits.length - 1;
            this.db
              .prepare(
                `INSERT INTO roadmap_missions (
                  id, roadmap_id, version_number, level_id, sort_order, title, description, mission_type,
                  subject_ids_json, topic_ids_json, subtopic_ids_json, question_count, difficulty_distribution_json,
                  time_limit_seconds, is_required, is_remedial, min_pass_accuracy_percent, xp_reward, stars_reward, coins_reward
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?)`
              )
              .run(
                mId,
                roadmapId,
                rm.currentVersion,
                levelId,
                idx + 1,
                isCkpt ? `${cleanTitle} Mastery Checkpoint` : `${cleanTitle} Mission ${idx + 1}`,
                isCkpt
                  ? 'Confirm understanding across level objectives to unlock the next challenge.'
                  : 'Practice progressive Grade 5 questions at a calm pace.',
                isCkpt ? 'mastery_checkpoint' : subjectIds.length > 1 ? 'mixed_topic' : 'topic_practice',
                JSON.stringify(subjectIds),
                JSON.stringify(payload.topicIds || []),
                JSON.stringify(payload.subtopicIds || []),
                cnt,
                JSON.stringify(difficultyDist),
                isCkpt ? Math.min(rm.wellbeingMaxSessionMinutes * 60, cnt * 60) : null,
                Math.max(50, Math.min(90, Number(payload.minMasteryAccuracyPercent || 65))),
                20 + seqOrder * 5,
                2,
                10 + idx * 3
              );
            this.db
              .prepare(
                `INSERT OR IGNORE INTO roadmap_mission_configs (mission_id, selection_rules_json, puzzle_hint_mode, allow_retry, max_attempts_per_day)
                 VALUES (?, '{}', 0, 1, 8)`
              )
              .run(mId);
          });
        }
      }

      this.db.prepare('UPDATE game_roadmaps SET updated_at = ? WHERE id = ?').run(now, roadmapId);
    });

    return this.getRoadmapDetail(actor, roadmapId);
  }

  public upsertMission(
    actor: UserAccount,
    levelId: string,
    payload: {
      id?: string;
      sortOrder?: number;
      title: string;
      description?: string;
      missionType: RoadmapMissionType;
      subjectIds?: string[];
      topicIds?: string[];
      subtopicIds?: string[];
      questionCount: number;
      difficultyDistribution?: RoadmapDifficultyWeights;
      timeLimitSeconds?: number | null;
      isRequired?: boolean;
      minPassAccuracyPercent?: number;
      xpReward?: number;
      starsReward?: number;
      coinsReward?: number;
      puzzleHintMode?: boolean;
      allowRetry?: boolean;
      maxAttemptsPerDay?: number;
    }
  ): GameRoadmapDetail {
    const lvlRow = this.db.prepare('SELECT * FROM roadmap_levels WHERE id = ?').get(levelId) as
      | Record<string, unknown>
      | undefined;
    if (!lvlRow) throw new HttpError(404, 'Roadmap level not found.');
    const rmRow = this.db.prepare('SELECT * FROM game_roadmaps WHERE id = ?').get(String(lvlRow.roadmap_id)) as
      | Record<string, unknown>
      | undefined;
    if (!rmRow) throw new HttpError(404, 'Roadmap not found.');
    const rm = this.hydrateRoadmapRow(rmRow);

    const subjectIds =
      payload.subjectIds && payload.subjectIds.length > 0
        ? payload.subjectIds
        : parseJsonSafe<string[]>(lvlRow.subject_ids_json, rm.subjectIds);
    this.assertTeacherOrAdminSubjectScope(actor, [...rm.subjectIds, ...subjectIds]);

    const cleanTitle = String(payload.title || '').trim();
    if (!cleanTitle) throw new HttpError(400, 'Mission title is required.');

    const qCount = Math.max(1, Math.min(20, Math.round(Number(payload.questionCount || 4))));
    const wbMaxSeconds = Math.max(300, rm.wellbeingMaxSessionMinutes * 60);
    const timeLimit =
      payload.timeLimitSeconds && payload.timeLimitSeconds > 0
        ? Math.min(wbMaxSeconds, Math.round(payload.timeLimitSeconds))
        : null;

    const existingMissions = (
      this.db.prepare('SELECT COUNT(*) as cnt FROM roadmap_missions WHERE level_id = ?').get(levelId) as {
        cnt: number;
      }
    ).cnt;
    const missionId = payload.id || `RMIS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const sortOrder = payload.sortOrder ? Math.max(1, Math.round(payload.sortOrder)) : existingMissions + 1;
    const diffDist =
      payload.difficultyDistribution ||
      parseJsonSafe<RoadmapDifficultyWeights>(lvlRow.difficulty_distribution_json, {
        Simple: 50,
        Moderate: 50,
        Challenging: 0,
        Master: 0,
      });

    const now = new Date().toISOString();
    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO roadmap_missions (
            id, roadmap_id, version_number, level_id, sort_order, title, description, mission_type,
            subject_ids_json, topic_ids_json, subtopic_ids_json, question_count, difficulty_distribution_json,
            time_limit_seconds, is_required, is_remedial, min_pass_accuracy_percent, xp_reward, stars_reward, coins_reward
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            sort_order = excluded.sort_order,
            title = excluded.title,
            description = excluded.description,
            mission_type = excluded.mission_type,
            subject_ids_json = excluded.subject_ids_json,
            topic_ids_json = excluded.topic_ids_json,
            subtopic_ids_json = excluded.subtopic_ids_json,
            question_count = excluded.question_count,
            difficulty_distribution_json = excluded.difficulty_distribution_json,
            time_limit_seconds = excluded.time_limit_seconds,
            is_required = excluded.is_required,
            min_pass_accuracy_percent = excluded.min_pass_accuracy_percent,
            xp_reward = excluded.xp_reward,
            stars_reward = excluded.stars_reward,
            coins_reward = excluded.coins_reward`
        )
        .run(
          missionId,
          rm.id,
          rm.currentVersion,
          levelId,
          sortOrder,
          cleanTitle,
          String(payload.description || '').trim(),
          payload.missionType || 'topic_practice',
          JSON.stringify(subjectIds),
          JSON.stringify(payload.topicIds || parseJsonSafe<string[]>(lvlRow.topic_ids_json, [])),
          JSON.stringify(payload.subtopicIds || parseJsonSafe<string[]>(lvlRow.subtopic_ids_json, [])),
          qCount,
          JSON.stringify(diffDist),
          timeLimit,
          payload.isRequired === false ? 0 : 1,
          payload.missionType === 'remedial' ? 1 : 0,
          Math.max(40, Math.min(95, Number(payload.minPassAccuracyPercent || 60))),
          Math.max(5, Number(payload.xpReward || 25)),
          Math.max(1, Number(payload.starsReward || 2)),
          Math.max(0, Number(payload.coinsReward || 10))
        );

      this.db
        .prepare(
          `INSERT INTO roadmap_mission_configs (
            mission_id, selection_rules_json, puzzle_hint_mode, allow_retry, max_attempts_per_day
          ) VALUES (?, '{}', ?, ?, ?)
          ON CONFLICT(mission_id) DO UPDATE SET
            puzzle_hint_mode = excluded.puzzle_hint_mode,
            allow_retry = excluded.allow_retry,
            max_attempts_per_day = excluded.max_attempts_per_day`
        )
        .run(
          missionId,
          payload.puzzleHintMode || payload.missionType === 'puzzle' ? 1 : 0,
          payload.allowRetry === false ? 0 : 1,
          Math.max(1, Math.min(20, Number(payload.maxAttemptsPerDay || 8)))
        );

      this.db.prepare('UPDATE game_roadmaps SET updated_at = ? WHERE id = ?').run(now, rm.id);
    });

    return this.getRoadmapDetail(actor, rm.id);
  }

  public transitionRoadmapStatus(
    actor: UserAccount,
    roadmapId: string,
    payload: { toStatus: RoadmapStatus; note?: string }
  ): GameRoadmapDetail {
    const rmRow = this.db.prepare('SELECT * FROM game_roadmaps WHERE id = ?').get(roadmapId) as
      | Record<string, unknown>
      | undefined;
    if (!rmRow) throw new HttpError(404, 'Roadmap not found.');
    const rm = this.hydrateRoadmapRow(rmRow);
    this.assertTeacherOrAdminSubjectScope(actor, rm.subjectIds);

    const toStatus = payload.toStatus;
    if (actor.role === 'teacher') {
      if (toStatus !== 'PENDING_REVIEW' && toStatus !== 'DRAFT') {
        throw new HttpError(
          403,
          'Teachers may submit roadmaps for review or return to draft; final approval and publishing require an administrator.'
        );
      }
    }

    const detail = this.getRoadmapDetail(actor, roadmapId);
    if (toStatus === 'PUBLISHED') {
      if (detail.levels.length === 0 || detail.missions.length === 0) {
        throw new HttpError(400, 'Cannot publish an empty roadmap without levels and missions.');
      }
      const zeroQuestionMissions = detail.availabilityIssues.filter((iss) => iss.availableCount === 0);
      if (zeroQuestionMissions.length > 0) {
        throw new HttpError(
          400,
          `Cannot publish roadmap: ${zeroQuestionMissions[0].message} Add approved active questions or adjust criteria.`
        );
      }
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE game_roadmaps SET
          status = ?,
          approved_by_user_id = CASE WHEN ? IN ('APPROVED','PUBLISHED') THEN ? ELSE approved_by_user_id END,
          approved_at = CASE WHEN ? IN ('APPROVED','PUBLISHED') THEN ? ELSE approved_at END,
          published_at = CASE WHEN ? = 'PUBLISHED' THEN COALESCE(published_at, ?) ELSE published_at END,
          updated_at = ?
         WHERE id = ?`
      )
      .run(toStatus, toStatus, actor.id, toStatus, now, toStatus, now, now, roadmapId);

    this.writeGamificationAudit({
      roadmapId,
      actor,
      eventType: `ROADMAP_${toStatus}`,
      summary: `Roadmap "${rm.name}" transitioned ${rm.status} -> ${toStatus}.${payload.note ? ' ' + payload.note : ''}`,
      details: { fromStatus: rm.status, toStatus, availabilityWarnings: detail.availabilityIssues.length },
    });

    return this.getRoadmapDetail(actor, roadmapId);
  }

  // =========================================================================
  // 4. STUDENT GAMIFICATION DASHBOARD, MISSION RUNNER & REWARD SYSTEM
  // =========================================================================

  public getStudentDashboard(actor: UserAccount, targetStudentId?: string): StudentGamificationDashboard {
    const studentId = actor.role === 'student' ? actor.id : targetStudentId || actor.id;
    this.assertCanViewStudent(actor, studentId);
    const student = this.academic.getUserById(studentId);
    if (!student) throw new HttpError(404, 'Student account not found.');

    const roadmaps = this.listRoadmaps(actor)
      .filter((d) => d.roadmap.status === 'PUBLISHED')
      .map((d) => this.getRoadmapDetail(actor, d.roadmap.id, studentId));

    const xpRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM student_reward_transactions WHERE student_id = ? AND reward_type = 'xp'`
      )
      .get(studentId) as { total: number };
    const coinsRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM student_reward_transactions WHERE student_id = ? AND reward_type = 'coins'`
      )
      .get(studentId) as { total: number };

    const totalXp = Number(xpRow.total || 0);
    const rankInfo = computeExplorerRankFromXp(totalXp);

    const rewardDefsRows = this.db
      .prepare('SELECT * FROM reward_definitions WHERE active = 1 ORDER BY id ASC')
      .all() as Record<string, unknown>[];
    const allRewardDefinitions = rewardDefsRows.map((r) => this.hydrateRewardRow(r));
    const rewardDefMap = new Map(allRewardDefinitions.map((r) => [r.id, r]));

    const unlockedRows = this.db
      .prepare(
        `SELECT * FROM student_unlocked_rewards
         WHERE student_id = ? ORDER BY unlocked_at DESC`
      )
      .all(studentId) as Record<string, unknown>[];
    const unlockedRewards: StudentUnlockedRewardRecord[] = unlockedRows
      .map((u) => {
        const def = rewardDefMap.get(String(u.reward_def_id));
        if (!def) return null;
        return {
          id: String(u.id),
          studentId: String(u.student_id),
          rewardDefId: String(u.reward_def_id),
          reward: def,
          equipped: Number(u.equipped ?? 0) === 1,
          unlockedAt: String(u.unlocked_at),
        };
      })
      .filter((x): x is StudentUnlockedRewardRecord => Boolean(x));

    const txRows = this.db
      .prepare(
        `SELECT * FROM student_reward_transactions
         WHERE student_id = ? ORDER BY created_at DESC LIMIT 25`
      )
      .all(studentId) as Record<string, unknown>[];
    const recentTransactions: RewardTransactionRecord[] = txRows.map((t) => ({
      id: String(t.id),
      studentId: String(t.student_id),
      roadmapId: t.roadmap_id ? String(t.roadmap_id) : null,
      levelId: t.level_id ? String(t.level_id) : null,
      missionAttemptId: t.mission_attempt_id ? String(t.mission_attempt_id) : null,
      rewardType: String(t.reward_type) as RewardTransactionRecord['rewardType'],
      rewardDefId: t.reward_def_id ? String(t.reward_def_id) : null,
      amount: Number(t.amount ?? 0),
      reason: String(t.reason),
      idempotencyKey: String(t.idempotency_key),
      createdAt: String(t.created_at),
    }));

    const wbAnalytics = this.wellbeing.getStudentStudyTimeAnalytics(actor, studentId, 1);
    const dailyMax = wbAnalytics.guidelineSummary.dailyMaxMinutes;
    const observed = wbAnalytics.todaySummary.activeMinutes;
    const scheduled = wbAnalytics.todaySummary.scheduledMinutes;
    const dailyLimitReached = observed >= dailyMax;
    const shouldTakeBreakSoon =
      wbAnalytics.todaySummary.continuousPeakMinutes >= wbAnalytics.guidelineSummary.breakIntervalMinutes ||
      observed >= wbAnalytics.guidelineSummary.dailyWarningMinutes;

    const supportiveMessage = dailyLimitReached
      ? `You have studied wonderfully today (${observed} active min). Rest time matters just as much as study — take a break and come back fresh tomorrow!`
      : shouldTakeBreakSoon
      ? `Great focus! Consider a gentle ${wbAnalytics.guidelineSummary.recommendedBreakMinutes}-minute stretch or water break before your next quest.`
      : `Balanced pace: ${observed} of ${dailyMax} min daily study guide used today. Take your time on each question!`;

    return {
      studentId,
      studentName: student.name,
      totalXp,
      explorerRank: rankInfo.rank,
      xpIntoCurrentRank: rankInfo.xpIntoCurrentRank,
      xpNeededForNextRank: rankInfo.xpNeededForNextRank,
      totalStars: student.stars,
      totalCoins: Number(coinsRow.total || 0),
      streakDays: student.streakDays,
      unlockedRewards,
      allRewardDefinitions,
      recentTransactions,
      roadmaps,
      wellbeingStatus: {
        dailyScheduledMinutes: scheduled,
        dailyObservedActiveMinutes: observed,
        dailyMaxMinutes: dailyMax,
        recommendedBreakMinutes: wbAnalytics.guidelineSummary.recommendedBreakMinutes,
        breakIntervalMinutes: wbAnalytics.guidelineSummary.breakIntervalMinutes,
        shouldTakeBreakSoon,
        dailyLimitReached,
        supportiveMessage,
      },
    };
  }

  public startMission(
    actor: UserAccount,
    missionId: string,
    targetStudentId?: string
  ): {
    missionAttemptId: string;
    mission: RoadmapMission;
    level: RoadmapLevel;
    roadmap: GameRoadmapRecord;
    questions: StudentQuizView[];
    shortageWarning: string | null;
    wellbeingNotice: string | null;
    dailyLimitReached: boolean;
  } {
    const studentId = actor.role === 'student' ? actor.id : targetStudentId || actor.id;
    this.assertCanViewStudent(actor, studentId);
    if (actor.role !== 'student' && actor.role !== 'admin') {
      throw new HttpError(403, 'Only the student (or administrator testing preview) may start a mission.');
    }

    const mRow = this.db
      .prepare(
        `SELECT m.*, c.puzzle_hint_mode, c.allow_retry, c.max_attempts_per_day
         FROM roadmap_missions m
         LEFT JOIN roadmap_mission_configs c ON c.mission_id = m.id
         WHERE m.id = ?`
      )
      .get(missionId) as Record<string, unknown> | undefined;
    if (!mRow) throw new HttpError(404, 'Mission not found.');

    const detail = this.getRoadmapDetail(actor, String(mRow.roadmap_id), studentId);
    const mission = detail.missions.find((m) => m.id === missionId);
    const level = detail.levels.find((l) => l.id === String(mRow.level_id));
    if (!mission || !level) throw new HttpError(404, 'Mission or level not found in current roadmap version.');

    if (detail.roadmap.status !== 'PUBLISHED' && actor.role === 'student') {
      throw new HttpError(403, 'This roadmap is not published yet.');
    }

    const lvlProg = detail.studentProgress?.levelProgress.find((lp) => lp.levelId === level.id);
    if (!lvlProg || lvlProg.status === 'LOCKED') {
      throw new HttpError(
        403,
        `Level "${level.title}" is still locked. Complete its prerequisite level(s) first to unlock it!`
      );
    }

    // Daily anti-farming attempt guard
    const todayPrefix = new Date().toISOString().slice(0, 10);
    const todayAttemptsCount = (
      this.db
        .prepare(
          `SELECT COUNT(*) as cnt FROM mission_attempts
           WHERE student_id = ? AND mission_id = ? AND completed_at IS NOT NULL AND substr(completed_at, 1, 10) = ?`
        )
        .get(studentId, mission.id, todayPrefix) as { cnt: number }
    ).cnt;
    if (todayAttemptsCount >= mission.maxAttemptsPerDay) {
      throw new HttpError(
        429,
        `You have practiced "${mission.title}" ${todayAttemptsCount} times today. Take a healthy break or explore another mission!`
      );
    }

    const selection = this.selectQuestionsForMissionFromBank({
      grade: detail.roadmap.grade,
      subjectIds: mission.subjectIds.length > 0 ? mission.subjectIds : level.subjectIds,
      topicIds: mission.topicIds,
      subtopicIds: mission.subtopicIds,
      questionCount: mission.questionCount,
      difficultyDistribution: mission.difficultyDistribution,
      studentId,
      preferMistakeTopics: mission.isRemedial || mission.missionType === 'revision',
    });

    if (selection.selected.length === 0) {
      throw new HttpError(
        400,
        selection.shortageNote || 'No approved questions are currently available for this mission.'
      );
    }

    const wb = this.wellbeing.getStudentStudyTimeAnalytics(actor, studentId, 1);
    const dailyLimitReached = wb.todaySummary.activeMinutes >= wb.guidelineSummary.dailyMaxMinutes;
    const wellbeingNotice = dailyLimitReached
      ? `Gentle Wellbeing Reminder: You have completed ${wb.todaySummary.activeMinutes} active study minutes today (daily guideline: ${wb.guidelineSummary.dailyMaxMinutes} min). Feel free to pause anytime and continue later!`
      : wb.todaySummary.continuousPeakMinutes >= wb.guidelineSummary.breakIntervalMinutes
      ? `Break Reminder: Remember to rest your eyes for ${wb.guidelineSummary.recommendedBreakMinutes} minutes after this short quest.`
      : null;

    const attemptId = `MA-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    const snapshotIds = selection.selected.map((q) => q.id);

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO mission_attempts (
            id, student_id, roadmap_id, level_id, mission_id, question_snapshot_ids_json,
            started_at, total_questions, idempotency_key
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          attemptId,
          studentId,
          detail.roadmap.id,
          level.id,
          mission.id,
          JSON.stringify(snapshotIds),
          now,
          snapshotIds.length,
          `STARTED-${attemptId}`
        );

      if (lvlProg.status === 'AVAILABLE') {
        this.db
          .prepare(
            `UPDATE student_level_progress SET status = 'ACTIVE', updated_at = ? WHERE student_id = ? AND level_id = ?`
          )
          .run(now, studentId, level.id);
      }
      this.db
        .prepare(
          `UPDATE student_roadmap_enrollments SET current_level_id = ? WHERE student_id = ? AND roadmap_id = ?`
        )
        .run(level.id, studentId, detail.roadmap.id);
    });

    // Return sanitized StudentQuizView (never expose correctIndex during active gameplay)
    const studentQuestions: StudentQuizView[] = selection.selected.map((q) => ({
      id: q.id,
      source: q.source,
      subjectId: q.subjectId,
      topicId: q.topicId,
      subtopicId: q.subtopicId,
      grade: q.grade,
      questionType: q.questionType,
      hint: q.hint,
      questionSi: q.questionSi,
      questionEn: q.questionEn,
      options: q.options,
      imageUrl: q.imageUrl,
      attributes: q.attributes,
    }));

    return {
      missionAttemptId: attemptId,
      mission,
      level,
      roadmap: detail.roadmap,
      questions: studentQuestions,
      shortageWarning: selection.shortageNote,
      wellbeingNotice,
      dailyLimitReached,
    };
  }

  public completeMission(
    actor: UserAccount,
    missionId: string,
    payload: {
      missionAttemptId: string;
      idempotencyKey: string;
      answers: {
        questionId: string;
        selectedIndex: number | null;
        hintUsed?: boolean;
        responseDurationMs?: number;
      }[];
      durationSeconds?: number;
      observedActiveSeconds?: number;
    }
  ): RoadmapMissionCompletionResult {
    const cleanIdem = String(payload.idempotencyKey || '').trim();
    if (!cleanIdem) throw new HttpError(400, 'idempotencyKey is required.');

    const studentId = actor.role === 'student' ? actor.id : '';
    const attemptRow = this.db
      .prepare('SELECT * FROM mission_attempts WHERE id = ? AND mission_id = ?')
      .get(payload.missionAttemptId, missionId) as Record<string, unknown> | undefined;

    if (!attemptRow) throw new HttpError(404, 'Mission attempt not found.');
    const targetStudentId = String(attemptRow.student_id);
    if (studentId && targetStudentId !== studentId) {
      throw new HttpError(403, 'Access denied to another student mission attempt.');
    }
    this.assertCanViewStudent(actor, targetStudentId);

    // Check idempotent replay (by idempotencyKey OR already-completed attemptId)
    const replayByKey = this.db
      .prepare('SELECT * FROM mission_attempts WHERE idempotency_key = ?')
      .get(cleanIdem) as Record<string, unknown> | undefined;
    if (replayByKey || attemptRow.completed_at) {
      const storedAttemptRow = replayByKey || attemptRow;
      return this.buildIdempotentCompletionReplay(actor, storedAttemptRow);
    }

    const student = this.academic.getUserById(targetStudentId);
    if (!student) throw new HttpError(404, 'Student not found.');

    const detail = this.getRoadmapDetail(actor, String(attemptRow.roadmap_id), targetStudentId);
    const mission = detail.missions.find((m) => m.id === missionId);
    const level = detail.levels.find((l) => l.id === String(attemptRow.level_id));
    if (!mission || !level) throw new HttpError(404, 'Mission or level not found.');

    const snapshotIds = parseJsonSafe<string[]>(attemptRow.question_snapshot_ids_json, []);
    const questions: QuizItem[] = [];
    for (const qId of snapshotIds) {
      const q = this.academic.resolveQuizById(qId);
      if (q) questions.push(q);
    }
    if (questions.length === 0) {
      throw new HttpError(400, 'Snapshot questions for this mission are unavailable.');
    }

    const answerMap = new Map(
      (payload.answers || []).map((a) => [String(a.questionId), a])
    );

    // 1. Record immutable question attempts via AcademicService (integrating repeated-error & stats pipelines!)
    const questionOutcomes: RoadmapMissionCompletionResult['questionOutcomes'] = [];
    let correctCount = 0;

    for (const q of questions) {
      const ans = answerMap.get(q.id);
      const selectedIdx =
        ans && typeof ans.selectedIndex === 'number' && Number.isInteger(ans.selectedIndex)
          ? ans.selectedIndex
          : null;
      const attemptRes = this.academic.recordQuestionAttempt({
        student,
        questionId: q.id,
        submittedAnswerIndex: selectedIdx,
        submissionStatus: selectedIdx !== null ? 'valid_answered' : 'skipped',
        responseDurationMs: Number(ans?.responseDurationMs || 15_000),
        hintUsed: Boolean(ans?.hintUsed),
        contextMode: mission.timeLimitSeconds ? 'timed_exam' : 'practice',
        sessionId: payload.missionAttemptId,
        deliveryContext: {
          mode: 'gamified_mission',
          roadmapId: detail.roadmap.id,
          levelId: level.id,
          missionId: mission.id,
        },
        idempotencyKey: `${cleanIdem}-q-${q.id}`,
        awardPracticeXp: false,
      });

      const isCorrect = attemptRes.attempt.isCorrect === true;
      if (isCorrect) correctCount++;

      questionOutcomes.push({
        questionId: q.id,
        isCorrect,
        correctIndex: q.correctIndex,
        selectedIndex: selectedIdx,
        explanation: q.explanation,
        memoryTrickTitle: q.memoryTrickTitle,
        memoryTrickBody: q.memoryTrickBody,
      });
    }

    const totalQuestions = questions.length;
    const accuracyPercent = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 1000) / 10 : 0;
    const masteryPassed = accuracyPercent >= mission.minPassAccuracyPercent;

    // 2. Check prior mastery (anti-farming) & wellbeing daily balance cap
    const priorMastery = this.db
      .prepare(
        `SELECT 1 FROM mission_attempts
         WHERE student_id = ? AND mission_id = ? AND mastery_passed = 1 AND completed_at IS NOT NULL AND id != ?
         LIMIT 1`
      )
      .get(targetStudentId, mission.id, payload.missionAttemptId);
    const alreadyMasteredBefore = Boolean(priorMastery);

    const wb = this.wellbeing.getStudentStudyTimeAnalytics(actor, targetStudentId, 1);
    const isWithinWellbeingDailyCap = wb.todaySummary.activeMinutes <= wb.guidelineSummary.dailyMaxMinutes;

    const rewardCalc = computeMissionRewards({
      mission,
      accuracyPercent,
      masteryPassed,
      alreadyMasteredBefore,
      isWithinWellbeingDailyCap,
    });

    const isCheckpointMission =
      mission.missionType === 'mastery_checkpoint' || mission.missionType === 'final_stage_challenge';
    const remAnalysis = analyzeMissionRemediationNeed({
      questions,
      outcomes: questionOutcomes.map((o) => ({ questionId: o.questionId, isCorrect: o.isCorrect })),
      minPassAccuracyPercent: mission.minPassAccuracyPercent,
      accuracyPercent,
    });

    const now = new Date().toISOString();
    const durSeconds = Math.max(
      1,
      Math.round(Number(payload.durationSeconds || questions.length * 25))
    );
    const activeSeconds = Math.max(
      1,
      Math.min(durSeconds, Math.round(Number(payload.observedActiveSeconds || durSeconds)))
    );

    let checkpointResult: MasteryCheckpointResultRecord | null = null;
    const rewardsGranted: RewardTransactionRecord[] = [];
    const unlockedCosmetics: RewardDefinition[] = [];
    let levelEvaluation!: RoadmapMissionCompletionResult['levelEvaluation'];
    let remedialMissionId: string | null = null;

    this.dbWrapper.transaction(() => {
      // Re-check atomic idempotency inside SQLite IMMEDIATE lock
      const lockedCheck = this.db
        .prepare('SELECT completed_at FROM mission_attempts WHERE id = ?')
        .get(payload.missionAttemptId) as { completed_at: string | null };
      if (lockedCheck?.completed_at) {
        return;
      }

      // Finalize mission attempt row
      this.db
        .prepare(
          `UPDATE mission_attempts SET
            completed_at = ?, duration_seconds = ?, observed_active_seconds = ?,
            total_questions = ?, correct_count = ?, accuracy_percent = ?,
            mastery_passed = ?, reward_granted = ?, idempotency_key = ?
           WHERE id = ?`
        )
        .run(
          now,
          durSeconds,
          activeSeconds,
          totalQuestions,
          correctCount,
          accuracyPercent,
          masteryPassed ? 1 : 0,
          rewardCalc.xp > 0 || rewardCalc.stars > 0 || rewardCalc.coins > 0 ? 1 : 0,
          cleanIdem,
          payload.missionAttemptId
        );

      // Grant mission XP / Stars / Coins idempotently
      const insertRewardTx = (
        rewardType: RewardTransactionRecord['rewardType'],
        amount: number,
        reason: string,
        suffix: string,
        rewardDefId: string | null = null,
        lvlId: string | null = level.id
      ): string | null => {
        if (amount <= 0 && !rewardDefId) return null;
        const txId = `SRT-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
        const txKey = `${cleanIdem}-${suffix}`;
        const info = this.db
          .prepare(
            `INSERT OR IGNORE INTO student_reward_transactions (
              id, student_id, roadmap_id, level_id, mission_attempt_id, reward_type,
              reward_def_id, amount, reason, idempotency_key, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            txId,
            targetStudentId,
            detail.roadmap.id,
            lvlId,
            payload.missionAttemptId,
            rewardType,
            rewardDefId,
            amount,
            reason,
            txKey,
            now
          );
        if (info.changes > 0) {
          rewardsGranted.push({
            id: txId,
            studentId: targetStudentId,
            roadmapId: detail.roadmap.id,
            levelId: lvlId,
            missionAttemptId: payload.missionAttemptId,
            rewardType,
            rewardDefId,
            amount,
            reason,
            idempotencyKey: txKey,
            createdAt: now,
          });
          return txId;
        }
        return null;
      };

      const unlockRewardDef = (rewardDefId: string | null, txId: string | null) => {
        if (!rewardDefId) return;
        const already = this.db
          .prepare('SELECT 1 FROM student_unlocked_rewards WHERE student_id = ? AND reward_def_id = ?')
          .get(targetStudentId, rewardDefId);
        if (already) return;
        this.db
          .prepare(
            `INSERT OR IGNORE INTO student_unlocked_rewards (
              id, student_id, reward_def_id, earned_via_transaction_id, equipped, unlocked_at
            ) VALUES (?, ?, ?, ?, 0, ?)`
          )
          .run(`SUR-${crypto.randomBytes(5).toString('hex').toUpperCase()}`, targetStudentId, rewardDefId, txId, now);
        const defRow = this.db.prepare('SELECT * FROM reward_definitions WHERE id = ?').get(rewardDefId) as
          | Record<string, unknown>
          | undefined;
        if (defRow) unlockedCosmetics.push(this.hydrateRewardRow(defRow));
      };

      if (rewardCalc.xp > 0) {
        insertRewardTx('xp', rewardCalc.xp, rewardCalc.explanation, 'xp');
      }
      if (rewardCalc.stars > 0) {
        insertRewardTx('stars', rewardCalc.stars, `Mission stars earned on "${mission.title}"`, 'stars');
        this.db.prepare('UPDATE users SET stars = stars + ? WHERE id = ?').run(rewardCalc.stars, targetStudentId);
      }
      if (rewardCalc.coins > 0) {
        insertRewardTx('coins', rewardCalc.coins, `Explorer Coins earned on "${mission.title}"`, 'coins');
      }

      // Record checkpoint / remediation outcome when applicable
      if (isCheckpointMission || remAnalysis.needsRemediation) {
        const ckId = `MCR-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
        this.db
          .prepare(
            `INSERT INTO mastery_checkpoint_results (
              id, student_id, roadmap_id, level_id, mission_attempt_id,
              accuracy_percent, passed, weak_topic_ids_json, remediation_recommended, feedback_note, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            ckId,
            targetStudentId,
            detail.roadmap.id,
            level.id,
            payload.missionAttemptId,
            accuracyPercent,
            masteryPassed ? 1 : 0,
            JSON.stringify(remAnalysis.weakTopicIds),
            remAnalysis.needsRemediation ? 1 : 0,
            remAnalysis.explanation,
            now
          );
        checkpointResult = {
          id: ckId,
          studentId: targetStudentId,
          roadmapId: detail.roadmap.id,
          levelId: level.id,
          missionAttemptId: payload.missionAttemptId,
          accuracyPercent,
          passed: masteryPassed,
          weakTopicIds: remAnalysis.weakTopicIds,
          remediationRecommended: remAnalysis.needsRemediation,
          feedbackNote: remAnalysis.explanation,
          createdAt: now,
        };
      }

      // Create/update optional remedial mission if needed (never skips level objectives!)
      if (remAnalysis.needsRemediation && !mission.isRemedial && remAnalysis.weakTopicIds.length > 0) {
        const existingRem = detail.missions.find((m) => m.levelId === level.id && m.isRemedial);
        if (existingRem) {
          remedialMissionId = existingRem.id;
        } else {
          const newRemId = `RMIS-REM-${level.id}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
          const topicNames = remAnalysis.weakTopicIds.slice(0, 2);
          this.db
            .prepare(
              `INSERT INTO roadmap_missions (
                id, roadmap_id, version_number, level_id, sort_order, title, description, mission_type,
                subject_ids_json, topic_ids_json, subtopic_ids_json, question_count, difficulty_distribution_json,
                time_limit_seconds, is_required, is_remedial, min_pass_accuracy_percent, xp_reward, stars_reward, coins_reward
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'remedial', ?, ?, '[]', 3, '{"Simple":60,"Moderate":40,"Challenging":0,"Master":0}', NULL, 0, 1, 60, 25, 2, 10)`
            )
            .run(
              newRemId,
              detail.roadmap.id,
              detail.roadmap.currentVersion,
              level.id,
              detail.missions.filter((m) => m.levelId === level.id).length + 1,
              `Calm Concept Boost (${level.title})`,
              `Targeted practice on concepts needing extra review (${topicNames.join(', ')}) before retrying.`,
              JSON.stringify(mission.subjectIds.length > 0 ? mission.subjectIds : level.subjectIds),
              JSON.stringify(remAnalysis.weakTopicIds)
            );
          this.db
            .prepare(
              `INSERT OR IGNORE INTO roadmap_mission_configs (mission_id, selection_rules_json, puzzle_hint_mode, allow_retry, max_attempts_per_day)
               VALUES (?, '{}', 1, 1, 8)`
            )
            .run(newRemId);
          remedialMissionId = newRemId;
        }
      }

      // Evaluate authoritative level progression & downstream level unlocking
      const completedMissionRows = this.db
        .prepare(
          `SELECT DISTINCT mission_id FROM mission_attempts
           WHERE student_id = ? AND level_id = ? AND mastery_passed = 1 AND completed_at IS NOT NULL`
        )
        .all(targetStudentId, level.id) as { mission_id: string }[];
      const completedMissionIds = new Set(completedMissionRows.map((r) => r.mission_id));

      const lpRow = this.db
        .prepare('SELECT * FROM student_level_progress WHERE student_id = ? AND level_id = ?')
        .get(targetStudentId, level.id) as Record<string, unknown>;
      const prevStatus = String(lpRow?.status || 'AVAILABLE') as RoadmapLevelStatus;
      const prevBestAcc = Number(lpRow?.best_accuracy_percent || 0);
      const nextBestAcc = Math.max(prevBestAcc, accuracyPercent);

      const ckptPassed =
        Number(lpRow?.checkpoint_passed || 0) === 1 ||
        (isCheckpointMission && masteryPassed) ||
        (!level.hasCheckpoint && masteryPassed);

      const prereqStatuses = new Map<string, RoadmapLevelStatus>();
      for (const lp of detail.studentProgress?.levelProgress || []) {
        prereqStatuses.set(lp.levelId, lp.status);
      }

      const evalResult = evaluateLevelCompletionEligibility({
        level,
        missions: detail.missions,
        completedMissionIds,
        bestCheckpointAccuracy: isCheckpointMission ? nextBestAcc : null,
        checkpointPassed: ckptPassed,
        prerequisiteStatuses: prereqStatuses,
        demonstratedObjectivesCount: masteryPassed ? level.academicObjectives.length || 1 : 0,
      });

      const newStatus: RoadmapLevelStatus =
        prevStatus === 'COMPLETED'
          ? 'COMPLETED'
          : evalResult.eligibleToComplete
          ? 'COMPLETED'
          : 'ACTIVE';
      const completedJustNow = prevStatus !== 'COMPLETED' && newStatus === 'COMPLETED';

      this.db
        .prepare(
          `UPDATE student_level_progress SET
            status = ?, best_accuracy_percent = ?, missions_completed_count = ?,
            checkpoint_passed = ?, objectives_covered_json = ?,
            completed_at = COALESCE(completed_at, ?), updated_at = ?
           WHERE student_id = ? AND level_id = ?`
        )
        .run(
          newStatus,
          nextBestAcc,
          completedMissionIds.size,
          ckptPassed ? 1 : 0,
          JSON.stringify(newStatus === 'COMPLETED' ? level.academicObjectives : []),
          newStatus === 'COMPLETED' ? now : null,
          now,
          targetStudentId,
          level.id
        );

      const unlockedNextLevels: { levelId: string; title: string }[] = [];
      if (completedJustNow) {
        // Grant level completion XP/stars/coins + optional cosmetic
        const lvlXpTx = insertRewardTx(
          'xp',
          level.xpReward,
          `Level mastered: "${level.title}"`,
          `lvl-xp-${level.id}`
        );
        if (level.starsReward > 0) {
          insertRewardTx('stars', level.starsReward, `Level completion stars: "${level.title}"`, `lvl-st-${level.id}`);
          this.db.prepare('UPDATE users SET stars = stars + ? WHERE id = ?').run(level.starsReward, targetStudentId);
        }
        if (level.coinsReward > 0) {
          insertRewardTx('coins', level.coinsReward, `Level mastery coins: "${level.title}"`, `lvl-cn-${level.id}`);
        }
        if (level.unlockCosmeticId) {
          const cTx = insertRewardTx(
            'avatar_cosmetic',
            1,
            `Unlocked cosmetic reward for mastering "${level.title}"`,
            `lvl-cos-${level.id}`,
            level.unlockCosmeticId
          );
          unlockRewardDef(level.unlockCosmeticId, cTx || lvlXpTx);
        }

        // Check if completing this level unlocks downstream prerequisite-dependent levels
        const updatedProgressRows = this.db
          .prepare('SELECT level_id, status FROM student_level_progress WHERE student_id = ? AND roadmap_id = ?')
          .all(targetStudentId, detail.roadmap.id) as { level_id: string; status: RoadmapLevelStatus }[];
        const statusLookup = new Map(updatedProgressRows.map((p) => [p.level_id, p.status]));

        for (const candidate of detail.levels) {
          if (statusLookup.get(candidate.id) !== 'LOCKED') continue;
          const allPrereqsMet = candidate.prerequisiteLevelIds.every(
            (prId) => statusLookup.get(prId) === 'COMPLETED'
          );
          if (allPrereqsMet) {
            this.db
              .prepare(
                `UPDATE student_level_progress SET status = 'AVAILABLE', unlocked_at = COALESCE(unlocked_at, ?), updated_at = ?
                 WHERE student_id = ? AND level_id = ?`
              )
              .run(now, now, targetStudentId, candidate.id);
            this.db
              .prepare(
                `INSERT INTO level_unlock_events (
                  id, student_id, roadmap_id, level_id, unlocked_by, trigger_mission_attempt_id, rationale, created_at
                ) VALUES (?, ?, ?, ?, 'completion', ?, ?, ?)`
              )
              .run(
                `LUE-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
                targetStudentId,
                detail.roadmap.id,
                candidate.id,
                payload.missionAttemptId,
                `Unlocked after completing prerequisite level "${level.title}".`,
                now
              );
            unlockedNextLevels.push({ levelId: candidate.id, title: candidate.title });
          }
        }

        if (unlockedNextLevels.length > 0) {
          this.db
            .prepare(
              `UPDATE student_roadmap_enrollments SET current_level_id = ? WHERE student_id = ? AND roadmap_id = ?`
            )
            .run(unlockedNextLevels[0].levelId, targetStudentId, detail.roadmap.id);
        }

        // Check stage milestone completion trophy
        const stage = detail.stages.find((s) => s.id === level.stageId);
        if (stage?.milestoneRewardBadgeId) {
          const stageLevels = detail.levels.filter((l) => l.stageId === stage.id);
          const allStageDone = stageLevels.every((sl) =>
            sl.id === level.id ? true : statusLookup.get(sl.id) === 'COMPLETED'
          );
          if (allStageDone) {
            const stgTx = insertRewardTx(
              'stage_trophy',
              1,
              `Stage milestone completed: "${stage.title}"`,
              `stg-${stage.id}`,
              stage.milestoneRewardBadgeId
            );
            unlockRewardDef(stage.milestoneRewardBadgeId, stgTx);
          }
        }

        // Notify linked guardians calmly of milestone achievement (no coin-spam!)
        const links = this.parentIntel.getVerifiedLinksForStudent(targetStudentId);
        for (const l of links) {
          if (l.consentGiven && l.canReceiveNotifications) {
            this.academic.insertNotificationRow({
              recipientUserId: l.guardianUserId,
              recipientRole: 'parent',
              channel: 'in_app',
              category: 'progress_report',
              title: `${student.name} Completed "${level.title}"!`,
              body: `Mastered ${level.title} in ${detail.roadmap.name} (${Math.round(nextBestAcc)}% accuracy). ${
                unlockedNextLevels.length > 0 ? `Unlocked: ${unlockedNextLevels.map((u) => u.title).join(', ')}.` : ''
              }`,
              dedupeKey: `rmap-lvl-done-${targetStudentId}-${level.id}`,
              deliveryStatus: 'delivered',
            });
          }
        }
      }

      levelEvaluation = {
        levelId: level.id,
        previousStatus: prevStatus,
        newStatus,
        completedJustNow,
        encouragementMessage: evalResult.encouragementMessage,
        unmetCriteria: evalResult.unmetCriteria,
        unlockedNextLevels,
      };
    });

    // Fallback if inside lock another request finalized concurrently
    const finalAttemptRow = this.db
      .prepare('SELECT * FROM mission_attempts WHERE id = ?')
      .get(payload.missionAttemptId) as Record<string, unknown>;
    if (!levelEvaluation) {
      return this.buildIdempotentCompletionReplay(actor, finalAttemptRow);
    }

    return {
      attempt: this.hydrateMissionAttemptRow(finalAttemptRow),
      checkpointResult,
      questionOutcomes,
      levelEvaluation,
      rewardsGranted,
      unlockedCosmetics,
      remediationSuggestion: remAnalysis.needsRemediation
        ? {
            triggered: true,
            weakTopicIds: remAnalysis.weakTopicIds,
            explanation: remAnalysis.explanation,
            remedialMissionId,
          }
        : null,
    };
  }

  private buildIdempotentCompletionReplay(
    actor: UserAccount,
    attemptRow: Record<string, unknown>
  ): RoadmapMissionCompletionResult {
    const attempt = this.hydrateMissionAttemptRow(attemptRow);
    const ckRow = this.db
      .prepare('SELECT * FROM mastery_checkpoint_results WHERE mission_attempt_id = ?')
      .get(attempt.id) as Record<string, unknown> | undefined;
    const txRows = this.db
      .prepare('SELECT * FROM student_reward_transactions WHERE mission_attempt_id = ?')
      .all(attempt.id) as Record<string, unknown>[];
    const lpRow = this.db
      .prepare('SELECT * FROM student_level_progress WHERE student_id = ? AND level_id = ?')
      .get(attempt.studentId, attempt.levelId) as Record<string, unknown> | undefined;
    const lvlStatus = String(lpRow?.status || 'ACTIVE') as RoadmapLevelStatus;

    return {
      attempt,
      checkpointResult: ckRow
        ? {
            id: String(ckRow.id),
            studentId: String(ckRow.student_id),
            roadmapId: String(ckRow.roadmap_id),
            levelId: String(ckRow.level_id),
            missionAttemptId: String(ckRow.mission_attempt_id),
            accuracyPercent: Number(ckRow.accuracy_percent),
            passed: Number(ckRow.passed) === 1,
            weakTopicIds: parseJsonSafe<string[]>(ckRow.weak_topic_ids_json, []),
            remediationRecommended: Number(ckRow.remediation_recommended) === 1,
            feedbackNote: String(ckRow.feedback_note),
            createdAt: String(ckRow.created_at),
          }
        : null,
      questionOutcomes: [],
      levelEvaluation: {
        levelId: attempt.levelId,
        previousStatus: lvlStatus,
        newStatus: lvlStatus,
        completedJustNow: false,
        encouragementMessage: 'This mission submission was already processed cleanly (duplicate submission prevented).',
        unmetCriteria: [],
        unlockedNextLevels: [],
      },
      rewardsGranted: txRows.map((t) => ({
        id: String(t.id),
        studentId: String(t.student_id),
        roadmapId: t.roadmap_id ? String(t.roadmap_id) : null,
        levelId: t.level_id ? String(t.level_id) : null,
        missionAttemptId: t.mission_attempt_id ? String(t.mission_attempt_id) : null,
        rewardType: String(t.reward_type) as RewardTransactionRecord['rewardType'],
        rewardDefId: t.reward_def_id ? String(t.reward_def_id) : null,
        amount: Number(t.amount ?? 0),
        reason: String(t.reason),
        idempotencyKey: String(t.idempotency_key),
        createdAt: String(t.created_at),
      })),
      unlockedCosmetics: [],
      remediationSuggestion: null,
    };
  }

  public equipReward(actor: UserAccount, rewardDefId: string): StudentUnlockedRewardRecord[] {
    if (actor.role !== 'student') {
      throw new HttpError(403, 'Only students can equip cosmetic rewards on their avatar.');
    }
    const unlocked = this.db
      .prepare('SELECT * FROM student_unlocked_rewards WHERE student_id = ? AND reward_def_id = ?')
      .get(actor.id, rewardDefId) as Record<string, unknown> | undefined;
    if (!unlocked) {
      throw new HttpError(404, 'You have not unlocked this reward yet.');
    }
    const currentlyEquipped = Number(unlocked.equipped ?? 0) === 1;
    this.db
      .prepare('UPDATE student_unlocked_rewards SET equipped = ? WHERE student_id = ? AND reward_def_id = ?')
      .run(currentlyEquipped ? 0 : 1, actor.id, rewardDefId);
    return this.getStudentDashboard(actor, actor.id).unlockedRewards;
  }

  // =========================================================================
  // 5. TIMETABLE MISSION SCHEDULING & PARENT/TEACHER PROGRESS REPORTS
  // =========================================================================

  public scheduleMissionToTimetable(
    actor: UserAccount,
    payload: {
      studentId: string;
      missionId: string;
      startDate: string;
      timeOfDay: string;
      timezone?: string;
      durationMinutes?: number;
    }
  ): { sessionId: string; warningMessages: string[] } {
    this.assertCanViewStudent(actor, payload.studentId);
    if (actor.role === 'teacher') {
      throw new HttpError(403, 'Parents, students (when permitted), or admins schedule study slots.');
    }
    if (actor.role === 'parent') {
      const link = this.db
        .prepare(
          `SELECT can_manage_schedule FROM guardian_student_links
           WHERE guardian_user_id = ? AND student_user_id = ? AND verified = 1`
        )
        .get(actor.id, payload.studentId) as { can_manage_schedule: number } | undefined;
      if (!link || Number(link.can_manage_schedule) !== 1) {
        throw new HttpError(403, 'Schedule management permission is required.');
      }
    }

    const mRow = this.db.prepare('SELECT * FROM roadmap_missions WHERE id = ?').get(payload.missionId) as
      | Record<string, unknown>
      | undefined;
    if (!mRow) throw new HttpError(404, 'Mission not found.');

    const timezone = payload.timezone || 'Asia/Colombo';
    if (!isValidTimeZone(timezone)) throw new HttpError(400, `Invalid timezone "${timezone}".`);

    const dur = Math.max(10, Math.min(45, Number(payload.durationMinutes || 20)));
    const startUtc = convertLocalDateTimeToUtcIso(payload.startDate, payload.timeOfDay, timezone);
    const endUtc = new Date(Date.parse(startUtc) + dur * 60_000).toISOString();
    const subjectIds = parseJsonSafe<string[]>(mRow.subject_ids_json, []);

    const wbCheck = this.wellbeing.validatePreSchedule(actor, {
      studentId: payload.studentId,
      subjectIds,
      proposedSlots: [
        {
          localDate: payload.startDate,
          startUtc,
          endUtc,
          durationMinutes: dur,
          title: `Quest Mission: ${String(mRow.title)}`,
        },
      ],
    });

    const sessionId = `SS-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO scheduled_sessions (
          id, timetable_id, student_id, created_by_user_id, title, activity_type, timezone,
          scheduled_start_utc, scheduled_end_utc, duration_minutes, grace_period_minutes,
          recurrence_key, status, max_attempts, attempts_used, filter_criteria_json,
          notes, source_roadmap_id, source_level_id, source_mission_id, created_at, updated_at
        ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 15, ?, 'SCHEDULED', 2, 0, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sessionId,
        payload.studentId,
        actor.id,
        `Quest Mission: ${String(mRow.title)}`,
        mRow.mission_type === 'mastery_checkpoint' ? 'revision' : 'practice',
        timezone,
        startUtc,
        endUtc,
        dur,
        `mission-${payload.missionId}-${payload.startDate}`,
        JSON.stringify({
          subjectIds,
          topicIds: parseJsonSafe<string[]>(mRow.topic_ids_json, []),
          questionCount: Number(mRow.question_count || 4),
          missionId: payload.missionId,
        }),
        `Scheduled from Quest Roadmap (${String(mRow.roadmap_id)}).`,
        String(mRow.roadmap_id),
        String(mRow.level_id),
        payload.missionId,
        now,
        now
      );

    this.parentIntel.syncReminderJobsForSession(sessionId);

    return {
      sessionId,
      warningMessages: wbCheck.severity === 'nominal' ? [] : [wbCheck.supportiveMessage],
    };
  }

  public getRoadmapProgressReport(
    actor: UserAccount,
    studentId: string,
    roadmapId?: string
  ): RoadmapProgressReport[] {
    this.assertCanViewStudent(actor, studentId);
    const student = this.academic.getUserById(studentId);
    if (!student) throw new HttpError(404, 'Student not found.');

    const allPublished = this.listRoadmaps(actor).filter((d) =>
      roadmapId ? d.roadmap.id === roadmapId : d.roadmap.status === 'PUBLISHED'
    );

    if (actor.role === 'teacher') {
      const ctx = this.academic.buildAuthContext(actor);
      const scoped = allPublished.filter((d) =>
        d.roadmap.subjectIds.some((sId) => canAccessSubject(ctx, sId))
      );
      if (roadmapId && scoped.length === 0) {
        throw new HttpError(403, 'Access denied: this roadmap is outside your assigned teacher subjects.');
      }
      return scoped.map((d) => this.buildSingleRoadmapReport(actor, student, d.roadmap.id));
    }

    return allPublished.map((d) => this.buildSingleRoadmapReport(actor, student, d.roadmap.id));
  }

  private buildSingleRoadmapReport(
    actor: UserAccount,
    student: UserAccount,
    roadmapId: string
  ): RoadmapProgressReport {
    const detail = this.getRoadmapDetail(actor, roadmapId, student.id);
    const levelProgress = detail.studentProgress?.levelProgress || [];
    const attempts = (detail.studentProgress?.recentAttempts || []).filter((a) => a.completedAt);

    const completedLevels = levelProgress.filter((lp) => lp.status === 'COMPLETED').length;
    const currentLvl = detail.levels.find((l) => l.id === detail.studentProgress?.currentLevelId);

    const totalQ = attempts.reduce((acc, a) => acc + a.totalQuestions, 0);
    const totalCorrect = attempts.reduce((acc, a) => acc + a.correctCount, 0);
    const overallAccuracyPercent = totalQ > 0 ? Math.round((totalCorrect / totalQ) * 1000) / 10 : null;
    const observedActiveMinutes = Math.round(
      attempts.reduce((acc, a) => acc + a.observedActiveSeconds, 0) / 60
    );

    // Skills practiced from question_skill_mappings across snapshotted questions
    const qIds = Array.from(new Set(attempts.flatMap((a) => a.questionSnapshotIds)));
    const skillCounts = new Map<EducationalSkillCategory, number>();
    if (qIds.length > 0) {
      const placeholders = qIds.map(() => '?').join(',');
      const skillRows = this.db
        .prepare(
          `SELECT skill_key, COUNT(*) as cnt
           FROM question_skill_mappings WHERE question_id IN (${placeholders})
           GROUP BY skill_key`
        )
        .all(...qIds) as { skill_key: EducationalSkillCategory; cnt: number }[];
      for (const sr of skillRows) {
        skillCounts.set(sr.skill_key, (skillCounts.get(sr.skill_key) || 0) + sr.cnt);
      }
    }

    const topicNameRows = this.db.prepare('SELECT id, name_en FROM topics').all() as {
      id: string;
      name_en: string;
    }[];
    const topicNames = new Map(topicNameRows.map((t) => [t.id, t.name_en]));

    const ckptRows = this.db
      .prepare(
        `SELECT * FROM mastery_checkpoint_results
         WHERE student_id = ? AND roadmap_id = ?
         ORDER BY created_at DESC LIMIT 20`
      )
      .all(student.id, roadmapId) as Record<string, unknown>[];
    const checkpointHistory: MasteryCheckpointResultRecord[] = ckptRows.map((c) => ({
      id: String(c.id),
      studentId: String(c.student_id),
      roadmapId: String(c.roadmap_id),
      levelId: String(c.level_id),
      missionAttemptId: String(c.mission_attempt_id),
      accuracyPercent: Number(c.accuracy_percent),
      passed: Number(c.passed) === 1,
      weakTopicIds: parseJsonSafe<string[]>(c.weak_topic_ids_json, []),
      remediationRecommended: Number(c.remediation_recommended) === 1,
      feedbackNote: String(c.feedback_note),
      createdAt: String(c.created_at),
    }));

    const topicErrCounts = new Map<string, number>();
    for (const ck of checkpointHistory) {
      for (const wt of ck.weakTopicIds) {
        topicErrCounts.set(wt, (topicErrCounts.get(wt) || 0) + 1);
      }
    }

    const adaptiveExplanations =
      detail.studentProgress?.adaptiveRecommendations.map((r) => r.explanation) || [];

    const suggestedNextActivities: string[] = [];
    if (detail.studentProgress && detail.studentProgress.adaptiveRecommendations.length > 0) {
      suggestedNextActivities.push(
        `Review calm remedial practice for: ${detail.studentProgress.adaptiveRecommendations[0].weakTopicNames.join(', ')}`
      );
    }
    if (currentLvl) {
      suggestedNextActivities.push(`Continue "${currentLvl.title}" next mission at a steady pace.`);
    }

    return {
      studentId: student.id,
      studentName: student.name,
      roadmapId: detail.roadmap.id,
      roadmapName: detail.roadmap.name,
      completedLevelsCount: completedLevels,
      totalLevelsCount: detail.levels.length,
      currentLevelTitle: currentLvl?.title || null,
      overallAccuracyPercent,
      totalMissionAttempts: attempts.length,
      observedActiveMinutes,
      skillsPracticed: Array.from(skillCounts.entries()).map(([skillKey, questionCount]) => ({
        skillKey,
        skillLabel: SKILL_LABEL_MAP.get(skillKey) || skillKey,
        questionCount,
      })),
      repeatedErrorTopics: Array.from(topicErrCounts.entries()).map(([topicId, errorCount]) => ({
        topicId,
        topicName: topicNames.get(topicId) || topicId,
        errorCount,
      })),
      checkpointHistory,
      adaptiveExplanations,
      suggestedNextActivities,
    };
  }

  private writeGamificationAudit(params: {
    studentId?: string;
    roadmapId?: string;
    actor: UserAccount;
    eventType: string;
    summary: string;
    details?: Record<string, unknown>;
  }): void {
    this.db
      .prepare(
        `INSERT INTO gamification_audit_events (
          id, student_id, roadmap_id, actor_id, actor_role, event_type, summary, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `GAE-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
        params.studentId || null,
        params.roadmapId || null,
        params.actor.id,
        params.actor.role,
        params.eventType,
        params.summary,
        JSON.stringify(params.details || {}),
        new Date().toISOString()
      );
  }
}
