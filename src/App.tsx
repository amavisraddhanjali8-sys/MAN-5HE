import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  FileText,
  Home,
  LayoutDashboard,
  Layers,
  MessageSquare,
  Newspaper,
  Settings,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  api,
  AuthUser,
  getStoredToken,
  setStoredToken,
  type StudentInterventionInstruction,
} from './lib/api';
import type {
  AttemptRecord,
  StudentTrajectory,
  SubjectCategory,
  SubtopicNode,
  TopicNode,
} from './lib/types';
import { AdminStudio, type AdminSectionId } from './components/AdminStudio';
import { AuthAndPaymentGate } from './components/AuthAndPaymentGate';
import { Man5heLogo } from './components/BrandVisuals';
import { ParentCommsHub } from './components/ParentCommsHub';
import { PracticeArena, type PracticeInitialFocus } from './components/PracticeArena';
import { ProfileAlertsMenu } from './components/ProfileAlertsMenu';
import { StudentHome } from './components/StudentHome';
import { SubjectProficiencyRadar } from './components/SubjectProficiencyRadar';
import { SystemDocsView } from './components/SystemDocsView';
import { TeacherPortal } from './components/TeacherPortal';
import { TimedExamHall } from './components/TimedExamHall';

type AppView =
  | 'home'
  | 'practice'
  | 'exams'
  | 'progress'
  | 'billing'
  | 'system'
  | 'teacher_overview'
  | 'teacher_questions'
  | 'teacher_interventions'
  | 'teacher_knowledge'
  | 'admin_overview'
  | 'admin_curriculum'
  | 'admin_papers'
  | 'admin_people'
  | 'admin_interventions'
  | 'admin_knowledge'
  | 'admin_settings';

function defaultViewForRole(role: AuthUser['role']): AppView {
  if (role === 'admin') return 'admin_overview';
  if (role === 'teacher') return 'teacher_overview';
  return 'home';
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState<AppView>('home');
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [trajectory, setTrajectory] = useState<StudentTrajectory | null>(null);
  const [poolCount, setPoolCount] = useState(500008);
  const [subjects, setSubjects] = useState<SubjectCategory[]>([]);
  const [topics, setTopics] = useState<TopicNode[]>([]);
  const [subtopics, setSubtopics] = useState<SubtopicNode[]>([]);
  const [studentInterventions, setStudentInterventions] = useState<
    StudentInterventionInstruction[]
  >([]);
  const [practiceFocus, setPracticeFocus] = useState<PracticeInitialFocus | null>(null);
  const [initialCaseId, setInitialCaseId] = useState<string | null>(null);

  const loadWorkspaceData = async (loggedUser: AuthUser, preserveView = false) => {
    try {
      const [analyticsRes, statsRes, hierRes, intRes] = await Promise.all([
        api.getStudentAnalytics(),
        api.getQuizStats(),
        api.getHierarchy(),
        loggedUser.role === 'student'
          ? api.getStudentInterventions()
          : Promise.resolve({ interventions: [] as StudentInterventionInstruction[] }),
      ]);
      setUser(analyticsRes.user);
      setAttempts(analyticsRes.attempts);
      setTrajectory(analyticsRes.trajectory);
      setPoolCount(statsRes.totalPoolCount);
      setSubjects(hierRes.subjects);
      setTopics(hierRes.topics);
      setSubtopics(hierRes.subtopics);
      setStudentInterventions(intRes.interventions);
      if (!preserveView) {
        setView(defaultViewForRole(analyticsRes.user.role));
      }
    } catch {
      // keep existing user
    }
  };

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setBooting(false);
      return;
    }
    api
      .getMe()
      .then((res) => loadWorkspaceData(res.user))
      .catch(() => {
        setStoredToken(null);
        setUser(null);
      })
      .finally(() => setBooting(false));
  }, []);

  const handleAuthenticated = async (loggedUser: AuthUser) => {
    setUser(loggedUser);
    await loadWorkspaceData(loggedUser);
  };

  const handleSignOut = () => {
    setStoredToken(null);
    setUser(null);
    setView('home');
    setPracticeFocus(null);
    setInitialCaseId(null);
  };

  const handleQuickShare = async () => {
    await api.sendProgressShare();
  };

  const handleUpdateDailyGoal = async (targetQuestions: number) => {
    const res = await api.updateDailyStudyGoal(targetQuestions);
    setUser(res.user);
  };

  const handleStartTargetedPractice = (item: StudentInterventionInstruction) => {
    setPracticeFocus({
      subjectId: item.subjectId,
      topicId: item.recommendedPracticeTopicId || item.topicId,
      subtopicId: item.subtopicId,
      questionId: item.questionId,
      interventionCaseId: item.id,
    });
    setView('practice');
  };

  if (booting) {
    return (
      <div className="min-h-screen bg-[#EAF5FF] flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl border border-[#DCEBFA] px-8 py-6 text-center space-y-2">
          <Man5heLogo size="md" />
          <div className="text-sm text-[#526A84]">Loading මං 5හේ Scholarship Platform...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthAndPaymentGate onAuthenticated={handleAuthenticated} />;
  }

  const navItems: { id: AppView; label: string; icon: React.ReactNode }[] =
    user.role === 'admin'
      ? [
          { id: 'admin_overview', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
          {
            id: 'admin_curriculum',
            label: 'Curriculum & Questions',
            icon: <BookOpen className="w-4 h-4" />,
          },
          { id: 'admin_papers', label: 'Examination Papers', icon: <Layers className="w-4 h-4" /> },
          {
            id: 'admin_people',
            label: 'Teachers & Students',
            icon: <Users className="w-4 h-4" />,
          },
          {
            id: 'admin_interventions',
            label: 'Interventions & Alerts',
            icon: <AlertTriangle className="w-4 h-4" />,
          },
          {
            id: 'admin_knowledge',
            label: 'Knowledge Publishing',
            icon: <Newspaper className="w-4 h-4" />,
          },
          {
            id: 'admin_settings',
            label: 'Settings & Billing',
            icon: <Settings className="w-4 h-4" />,
          },
        ]
      : user.role === 'teacher'
      ? [
          {
            id: 'teacher_overview',
            label: 'Overview',
            icon: <LayoutDashboard className="w-4 h-4" />,
          },
          {
            id: 'teacher_questions',
            label: 'Question Analytics',
            icon: <BarChart3 className="w-4 h-4" />,
          },
          {
            id: 'teacher_interventions',
            label: 'Interventions',
            icon: <AlertTriangle className="w-4 h-4" />,
          },
          {
            id: 'teacher_knowledge',
            label: 'Knowledge Hub',
            icon: <Newspaper className="w-4 h-4" />,
          },
        ]
      : [
          { id: 'home', label: 'Home', icon: <Home className="w-4 h-4" /> },
          { id: 'practice', label: 'Learn & Practise', icon: <BookOpen className="w-4 h-4" /> },
          { id: 'exams', label: 'Examinations', icon: <FileText className="w-4 h-4" /> },
          { id: 'progress', label: 'My Progress', icon: <TrendingUp className="w-4 h-4" /> },
        ];

  const topHeaderNav = navItems.slice(0, 4);

  const adminSectionFromView = (v: AppView): AdminSectionId => {
    switch (v) {
      case 'admin_curriculum':
        return 'curriculum';
      case 'admin_papers':
        return 'papers';
      case 'admin_people':
        return 'people';
      case 'admin_interventions':
        return 'interventions';
      case 'admin_knowledge':
        return 'knowledge';
      case 'admin_settings':
        return 'settings';
      default:
        return 'overview';
    }
  };

  const viewFromAdminSection = (sec: AdminSectionId): AppView => {
    switch (sec) {
      case 'curriculum':
        return 'admin_curriculum';
      case 'papers':
        return 'admin_papers';
      case 'people':
        return 'admin_people';
      case 'interventions':
        return 'admin_interventions';
      case 'knowledge':
        return 'admin_knowledge';
      case 'settings':
        return 'admin_settings';
      default:
        return 'admin_overview';
    }
  };

  return (
    <div className="min-h-screen bg-[#EAF5FF] text-[#0F2942] p-2 sm:p-4 lg:p-6">
      <div className="max-w-[1400px] mx-auto bg-white rounded-[28px] border border-[#D4E7FA] shadow-sm overflow-hidden flex flex-col min-h-[calc(100vh-3rem)]">
        {/* Top Bar Contract: Zone 1 Brand Wordmark | Zone 2 Single-Line Role Nav Links | Zone 3 Profile & Alerts Menu */}
        <header className="flex items-center justify-between gap-6 px-5 sm:px-7 py-4 border-b border-[#E5F0FA] bg-white">
          <button
            type="button"
            onClick={() => setView(defaultViewForRole(user.role))}
            className="text-left whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#158EE3] rounded-xl"
          >
            <Man5heLogo size="sm" />
          </button>

          <nav
            aria-label="Primary Navigation"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-[#476481]"
          >
            {topHeaderNav.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={`hover:text-[#0F2942] transition-colors whitespace-nowrap shrink-0 ${
                  view === item.id ? 'text-[#158EE3] font-bold underline underline-offset-8' : ''
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <ProfileAlertsMenu
              user={user}
              subjects={subjects}
              onUserUpdated={(updated) => setUser(updated)}
              onSignOut={handleSignOut}
              onOpenCase={(caseId) => {
                setInitialCaseId(caseId);
                if (user.role === 'teacher') {
                  setView('teacher_interventions');
                } else if (user.role === 'admin') {
                  setView('admin_interventions');
                } else {
                  setView('progress');
                }
              }}
              onOpenPublication={(pubId) => {
                if (user.role === 'teacher') {
                  setView('teacher_knowledge');
                } else if (user.role === 'admin') {
                  setView('admin_knowledge');
                } else {
                  setPracticeFocus({ initialMode: 'knowledge', publicationId: pubId });
                  setView('practice');
                }
              }}
            />
          </div>
        </header>

        {/* Workspace Shell: Left Role Sidebar + Main Viewport */}
        <div className="flex-1 flex flex-col lg:flex-row">
          <aside className="lg:w-64 bg-[#F7FBFF] border-b lg:border-b-0 lg:border-r border-[#E5F0FA] p-4 flex lg:flex-col gap-1.5 overflow-x-auto">
            {navItems.map((item) => {
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[#E5F2FF] text-[#158EE3]'
                      : 'text-[#476481] hover:bg-[#EDF6FF] hover:text-[#0F2942]'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}

            <div className="hidden lg:block mt-auto pt-6 border-t border-[#E5F0FA] space-y-2 px-2">
              <div className="text-xs font-bold text-[#0F2942] truncate">{user.name}</div>
              <div className="text-[11px] font-mono text-[#526A84]">
                {user.userIdCode} · {user.role.toUpperCase()}
              </div>
              {user.role === 'teacher' ? (
                <div className="text-[11px] font-semibold text-[#158EE3]">
                  {(user.assignedSubjectIds || []).length} Assigned Subject
                  {(user.assignedSubjectIds || []).length === 1 ? '' : 's'}
                </div>
              ) : (
                <div className="text-[11px] font-semibold text-[#2E7D32] flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" />
                  <span>{user.subscriptionStatus === 'active' ? 'Paid Active' : 'Trial Preview'}</span>
                </div>
              )}
            </div>
          </aside>

          <main className="flex-1 bg-[#F8FBFF] p-4 sm:p-6 lg:p-7 overflow-y-auto">
            {/* STUDENT PORTAL */}
            {view === 'home' && trajectory && (
              <StudentHome
                user={user}
                trajectory={trajectory}
                attempts={attempts}
                poolCount={poolCount}
                interventions={studentInterventions}
                onStartTargetedPractice={handleStartTargetedPractice}
                onNavigate={(next) => {
                  if (next === 'parents') {
                    setView('progress');
                  } else {
                    setView(next);
                  }
                }}
                onQuickShare={handleQuickShare}
                onUpdateDailyGoal={handleUpdateDailyGoal}
              />
            )}

            {view === 'practice' && (
              <PracticeArena
                user={user}
                trajectory={trajectory}
                subjects={subjects}
                topics={topics}
                subtopics={subtopics}
                initialFocus={practiceFocus}
                onConsumeInitialFocus={() => setPracticeFocus(null)}
                onUserAndTrajectoryUpdate={(nextUser, nextTraj) => {
                  setUser(nextUser);
                  if (nextTraj) setTrajectory(nextTraj);
                  loadWorkspaceData(nextUser, true);
                }}
              />
            )}

            {view === 'exams' && (
              <TimedExamHall
                user={user}
                onAttemptComplete={(nextUser, nextTraj) => {
                  setUser(nextUser);
                  setTrajectory(nextTraj);
                  loadWorkspaceData(nextUser, true);
                }}
              />
            )}

            {view === 'progress' && (
              <div className="space-y-6" data-testid="student-progress-view">
                {trajectory && (
                  <SubjectProficiencyRadar
                    attempts={attempts}
                    trajectory={trajectory}
                    onPracticeFallback={() => setView('practice')}
                  />
                )}

                {studentInterventions.length > 0 && (
                  <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
                    <h2 className="text-base font-display font-bold text-[#0F2942]">
                      Teacher Feedback &amp; Active Learning Plans ({studentInterventions.length})
                    </h2>
                    <div className="space-y-3">
                      {studentInterventions.map((item) => (
                        <div
                          key={item.id}
                          className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] flex flex-wrap items-center justify-between gap-4"
                        >
                          <div className="space-y-1 flex-1 min-w-[240px]">
                            <div className="text-xs font-bold text-[#158EE3]">
                              {item.subjectName} · {item.topicName} · {item.teacherName}
                            </div>
                            <div className="text-sm font-bold text-[#0F2942]">
                              {item.instructionTitle || `Practice Focus: ${item.topicName}`}
                            </div>
                            <div className="text-xs text-[#476481]">{item.instructionBody}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleStartTargetedPractice(item)}
                            className="px-4 py-2 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl shrink-0"
                          >
                            Start Assigned Practice
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <ParentCommsHub user={user} onOpenBilling={() => setView('billing')} />
              </div>
            )}

            {view === 'billing' && (
              <AuthAndPaymentGate
                existingUser={user}
                paymentModeOnly={true}
                onAuthenticated={handleAuthenticated}
                onPaymentComplete={(updatedUser) => {
                  setUser(updatedUser);
                  loadWorkspaceData(updatedUser, true);
                }}
                onBackToDashboard={() => setView(defaultViewForRole(user.role))}
              />
            )}

            {view === 'system' && <SystemDocsView />}

            {/* TEACHER PORTAL */}
            {user.role === 'teacher' &&
              (view === 'teacher_overview' ||
                view === 'teacher_questions' ||
                view === 'teacher_interventions' ||
                view === 'teacher_knowledge') && (
                <TeacherPortal
                  user={user}
                  activeSection={
                    view === 'teacher_questions'
                      ? 'questions'
                      : view === 'teacher_interventions'
                      ? 'interventions'
                      : view === 'teacher_knowledge'
                      ? 'knowledge'
                      : 'overview'
                  }
                  onNavigateSection={(sec) =>
                    setView(
                      sec === 'questions'
                        ? 'teacher_questions'
                        : sec === 'interventions'
                        ? 'teacher_interventions'
                        : sec === 'knowledge'
                        ? 'teacher_knowledge'
                        : 'teacher_overview'
                    )
                  }
                  subjects={subjects}
                  topics={topics}
                  subtopics={subtopics}
                  initialCaseId={initialCaseId}
                  onClearInitialCase={() => setInitialCaseId(null)}
                />
              )}

            {/* ADMIN PORTAL */}
            {user.role === 'admin' && view.startsWith('admin_') && (
              <AdminStudio
                user={user}
                activeSection={adminSectionFromView(view)}
                onSectionChange={(sec) => setView(viewFromAdminSection(sec))}
                subjects={subjects}
                topics={topics}
                subtopics={subtopics}
                initialCaseId={initialCaseId}
                onClearInitialCase={() => setInitialCaseId(null)}
                onOpenBilling={() => setView('billing')}
                onOpenDocs={() => setView('system')}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
