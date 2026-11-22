import React, { useEffect, useState } from 'react';
import { BookOpen, Calendar, Compass, FileText, Lock, Sliders, Users } from 'lucide-react';
import { api, AuthUser } from '../lib/api';
import type { SubjectCategory, SubtopicNode, TopicNode } from '../lib/types';
import { AssessmentBuilderWorkspace } from './AssessmentBuilderWorkspace';
import { InterventionWorkspace } from './InterventionWorkspace';
import { KnowledgePublishingConsole } from './KnowledgePublishingConsole';
import { QuestionBankManager } from './QuestionBankManager';
import { QuestionReviewDrawer } from './QuestionReviewDrawer';
import { RoadmapBuilderConsole } from './RoadmapBuilderConsole';
import { RoutineReviewConsole } from './RoutineReviewConsole';
import { ScopedAnalyticsView } from './ScopedAnalyticsView';
import { TimetablePresetManager } from './TimetablePresetManager';
import { WellbeingCaseConsole } from './WellbeingCaseConsole';
import { WellbeingRulesManager } from './WellbeingRulesManager';

interface TeacherPortalProps {
  user: AuthUser;
  activeSection: 'overview' | 'questions' | 'interventions' | 'knowledge';
  onNavigateSection: (sec: 'overview' | 'questions' | 'interventions' | 'knowledge') => void;
  subjects: SubjectCategory[];
  topics: TopicNode[];
  subtopics: SubtopicNode[];
  initialCaseId?: string | null;
  onClearInitialCase?: () => void;
}

export function TeacherPortal({
  user,
  activeSection,
  onNavigateSection,
  subjects,
  topics,
  subtopics,
  initialCaseId,
  onClearInitialCase,
}: TeacherPortalProps) {
  const assignedIds = user.assignedSubjectIds || [];
  const authorizedSubjects = subjects.filter((s) => assignedIds.includes(s.id));
  const authorizedTopics = topics.filter((t) => assignedIds.includes(t.subjectId));
  const authorizedSubtopics = subtopics.filter((st) => assignedIds.includes(st.subjectId));

  const [questionTab, setQuestionTab] = useState<
    'bank' | 'assessments' | 'presets' | 'routines' | 'roadmaps'
  >('bank');
  const [interventionTab, setInterventionTab] = useState<'academic' | 'wellbeing' | 'guidelines'>('academic');
  const [inspectedQuestionId, setInspectedQuestionId] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(initialCaseId || null);
  const [parentSupportSummaries, setParentSupportSummaries] = useState<
    {
      reportId: string;
      studentId: string;
      studentName: string;
      assessmentTitle: string;
      scorePercent: number | null;
      generatedAt: string;
      needsAttentionTopics: string[];
    }[]
  >([]);

  useEffect(() => {
    if (initialCaseId) {
      setSelectedCaseId(initialCaseId);
    }
  }, [initialCaseId]);

  useEffect(() => {
    if (activeSection === 'overview' && assignedIds.length > 0) {
      api
        .getTeacherParentSupportInsights()
        .then((res) => setParentSupportSummaries(res.recentParentSupportSummaries))
        .catch(() => {});
    }
  }, [activeSection, assignedIds.length]);

  if (authorizedSubjects.length === 0) {
    return (
      <div
        data-testid="teacher-no-subjects"
        className="bg-white rounded-3xl border border-[#DCEBFA] p-10 text-center max-w-2xl mx-auto space-y-3"
      >
        <div className="w-12 h-12 rounded-2xl bg-[#FFF6EB] border border-[#FAD49B] flex items-center justify-center mx-auto text-[#F96A1B]">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-display font-extrabold text-[#0F2942]">
          No Subject Categories Assigned
        </h2>
        <p className="text-sm text-[#526A84]">
          No subject categories are currently assigned to your teacher account ({user.userIdCode}).
          Please contact your administrator to grant subject permissions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="teacher-portal">
      {/* Scope Banner */}
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-bold text-[#158EE3]">
            Teacher Subject-Scoped Workspace · {user.userIdCode}
          </div>
          <h1 className="text-xl font-display font-extrabold text-[#0F2942]">
            {user.name} · Academic Analytics &amp; Student Interventions
          </h1>
          <p className="text-xs text-[#526A84] mt-0.5">
            Authorized Subjects:{' '}
            <strong className="text-[#0F2942]">
              {authorizedSubjects.map((s) => s.nameEn).join(' · ')}
            </strong>
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-[#476481] bg-[#F3F9FF] border border-[#CBE2FA] px-3.5 py-2 rounded-xl">
          <BookOpen className="w-4 h-4 text-[#158EE3]" />
          <span>
            {authorizedSubjects.length} Assigned Subject{authorizedSubjects.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {activeSection === 'overview' && (
        <div className="space-y-6">
          <ScopedAnalyticsView
            role="teacher"
            subjects={authorizedSubjects}
            topics={authorizedTopics}
            subtopics={authorizedSubtopics}
            onInspectQuestion={(qId) => setInspectedQuestionId(qId)}
            onOpenInterventions={() => onNavigateSection('interventions')}
          />

          {parentSupportSummaries.length > 0 && (
            <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-[#E5F0FA]">
                <Users className="w-4 h-4 text-[#158EE3]" />
                <h2 className="text-base font-display font-bold text-[#0F2942]">
                  Recent Home Parent-Support Topics (Assigned Subjects)
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {parentSupportSummaries.slice(0, 6).map((sum) => (
                  <div
                    key={sum.reportId}
                    className="p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[#0F2942]">{sum.studentName}</span>
                      <span className="font-bold text-[#158EE3] tabular-nums">
                        {sum.scorePercent === null ? 'Pending' : `${sum.scorePercent}%`}
                      </span>
                    </div>
                    <div className="text-[#476481]">{sum.assessmentTitle}</div>
                    {sum.needsAttentionTopics.length > 0 && (
                      <div className="text-[11px] text-[#9A5B00]">
                        Home focus: {sum.needsAttentionTopics.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeSection === 'questions' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-2xl border border-[#DCEBFA] p-3">
            <div className="text-xs font-semibold text-[#526A84] px-2">
              Author &amp; manage questions, practice sessions, mock papers, and timetable presets within your authorized subjects
            </div>
            <div className="flex flex-wrap items-center gap-1 p-1 bg-[#F3F9FF] rounded-xl border border-[#DCEBFA]">
              <button
                type="button"
                data-testid="teacher-tab-bank"
                onClick={() => setQuestionTab('bank')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  questionTab === 'bank'
                    ? 'bg-[#158EE3] text-white'
                    : 'text-[#526A84] hover:text-[#0F2942]'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>My Subject Questions</span>
              </button>
              <button
                type="button"
                data-testid="teacher-tab-assessments"
                onClick={() => setQuestionTab('assessments')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  questionTab === 'assessments'
                    ? 'bg-[#F96A1B] text-white'
                    : 'text-[#526A84] hover:text-[#0F2942]'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Practice &amp; Mock Papers</span>
              </button>
              <button
                type="button"
                data-testid="teacher-tab-presets"
                onClick={() => setQuestionTab('presets')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  questionTab === 'presets'
                    ? 'bg-[#2E7D32] text-white'
                    : 'text-[#526A84] hover:text-[#0F2942]'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Timetable Presets</span>
              </button>
              <button
                type="button"
                data-testid="teacher-tab-routines"
                onClick={() => setQuestionTab('routines')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  questionTab === 'routines'
                    ? 'bg-[#6D28D9] text-white'
                    : 'text-[#526A84] hover:text-[#0F2942]'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Parent Routines</span>
              </button>
              <button
                type="button"
                data-testid="teacher-tab-roadmaps"
                onClick={() => setQuestionTab('roadmaps')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  questionTab === 'roadmaps'
                    ? 'bg-[#0F2942] text-white'
                    : 'text-[#526A84] hover:text-[#0F2942]'
                }`}
              >
                <Compass className="w-3.5 h-3.5" />
                <span>Quest Roadmaps</span>
              </button>
            </div>
          </div>

          {questionTab === 'bank' ? (
            <QuestionBankManager
              role="teacher"
              user={user}
              subjects={authorizedSubjects}
              topics={authorizedTopics}
              subtopics={authorizedSubtopics}
              onInspectQuestion={(qId) => setInspectedQuestionId(qId)}
            />
          ) : questionTab === 'assessments' ? (
            <AssessmentBuilderWorkspace
              role="teacher"
              user={user}
              subjects={authorizedSubjects}
              topics={authorizedTopics}
            />
          ) : questionTab === 'routines' ? (
            <RoutineReviewConsole role="teacher" user={user} subjects={authorizedSubjects} />
          ) : questionTab === 'roadmaps' ? (
            <RoadmapBuilderConsole
              role="teacher"
              user={user}
              subjects={authorizedSubjects}
              topics={authorizedTopics}
            />
          ) : (
            <TimetablePresetManager
              role="teacher"
              user={user}
              subjects={authorizedSubjects}
              topics={authorizedTopics}
            />
          )}
        </div>
      )}

      {activeSection === 'interventions' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-2xl border border-[#DCEBFA] p-3">
            <div className="text-xs font-semibold text-[#526A84] px-2">
              Manage repeated-error academic interventions, subject-scoped wellbeing reviews, and study pacing guidelines
            </div>
            <div className="flex flex-wrap items-center gap-1 p-1 bg-[#F3F9FF] rounded-xl border border-[#DCEBFA]">
              <button
                type="button"
                data-testid="teacher-interventions-academic"
                onClick={() => setInterventionTab('academic')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap shrink-0 ${
                  interventionTab === 'academic'
                    ? 'bg-[#158EE3] text-white'
                    : 'text-[#526A84] hover:text-[#0F2942]'
                }`}
              >
                Repeated-Error Academic Cases
              </button>
              <button
                type="button"
                data-testid="teacher-interventions-wellbeing"
                onClick={() => setInterventionTab('wellbeing')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap shrink-0 ${
                  interventionTab === 'wellbeing'
                    ? 'bg-[#0F2942] text-white'
                    : 'text-[#526A84] hover:text-[#0F2942]'
                }`}
              >
                Study Wellbeing &amp; Parent Contact
              </button>
              <button
                type="button"
                data-testid="teacher-interventions-guidelines"
                onClick={() => setInterventionTab('guidelines')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap shrink-0 ${
                  interventionTab === 'guidelines'
                    ? 'bg-[#2E7D32] text-white'
                    : 'text-[#526A84] hover:text-[#0F2942]'
                }`}
              >
                Pacing Guideline Proposals
              </button>
            </div>
          </div>

          {interventionTab === 'academic' ? (
            <InterventionWorkspace
              subjects={authorizedSubjects}
              topics={authorizedTopics}
              initialCaseId={selectedCaseId}
              onInspectQuestion={(qId) => setInspectedQuestionId(qId)}
            />
          ) : interventionTab === 'wellbeing' ? (
            <WellbeingCaseConsole role="teacher" user={user} />
          ) : (
            <WellbeingRulesManager role="teacher" user={user} subjects={authorizedSubjects} />
          )}
        </div>
      )}

      {activeSection === 'knowledge' && (
        <KnowledgePublishingConsole
          role="teacher"
          subjects={authorizedSubjects}
          topics={authorizedTopics}
          subtopics={authorizedSubtopics}
        />
      )}

      <QuestionReviewDrawer
        questionId={inspectedQuestionId}
        onClose={() => setInspectedQuestionId(null)}
        onOpenCase={(cId) => {
          setInspectedQuestionId(null);
          setSelectedCaseId(cId);
          onClearInitialCase?.();
          onNavigateSection('interventions');
        }}
      />
    </div>
  );
}
