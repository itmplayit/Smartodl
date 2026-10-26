import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import MainLayout from '../layouts/MainLayout';
import DashboardLayout from '../layouts/DashboardLayout';
import ProtectedRoute from '../components/ProtectedRoute';

/* ------------------------------- public pages ------------------------------- */
const Landing = lazy(() => import('../pages/Landing'));
const MockInterviews = lazy(() => import('../pages/MockInterviews'));
const Courses = lazy(() => import('../pages/Courses'));
const CourseDetail = lazy(() => import('../pages/CourseDetail'));
const Notes = lazy(() => import('../pages/Notes'));
const Quizzes = lazy(() => import('../pages/Quizzes'));
const QuizDetail = lazy(() => import('../pages/QuizDetail'));
const QuizAttempt = lazy(() => import('../pages/QuizAttempt'));
const LiveQuiz = lazy(() => import('../pages/LiveQuiz'));
const SecondCamera = lazy(() => import('../pages/SecondCamera'));
const CodingArena = lazy(() => import('../pages/CodingArena'));
const ProblemDetail = lazy(() => import('../pages/ProblemDetail'));
const Contests = lazy(() => import('../pages/Contests'));
const ContestDetail = lazy(() => import('../pages/ContestDetail'));
const Leaderboard = lazy(() => import('../pages/Leaderboard'));
const About = lazy(() => import('../pages/About'));
const Contact = lazy(() => import('../pages/Contact'));
const SearchResults = lazy(() => import('../pages/SearchResults'));
const Profile = lazy(() => import('../pages/Profile'));
const Pricing = lazy(() => import('../pages/Pricing'));
const Subscription = lazy(() => import('../pages/Subscription'));
const Settings = lazy(() => import('../pages/Settings'));
const NotFound = lazy(() => import('../pages/NotFound'));
const VerifyCert = lazy(() => import('../pages/VerifyCert'));
const VerifyCertificateSearch = lazy(() => import('../pages/VerifyCertificateSearch'));
const SitePage = lazy(() => import('../pages/SitePage'));
const Faq = lazy(() => import('../pages/Faq'));

/* --------------------------------- auth --------------------------------- */
const Login = lazy(() => import('../pages/Login'));
const Register = lazy(() => import('../pages/Register'));
const ForgotPassword = lazy(() => import('../pages/ForgotPassword'));
const ResetPassword = lazy(() => import('../pages/ResetPassword'));
const OAuthCallback = lazy(() => import('../pages/OAuthCallback'));

/* -------------------------------- student -------------------------------- */
const StudentDashboard = lazy(() => import('../student/Dashboard'));
const MyCourses = lazy(() => import('../student/MyCourses'));
const StudentAchievements = lazy(() => import('../student/Achievements'));
const StudentResults = lazy(() => import('../student/Results'));
const MyCertificates = lazy(() => import('../student/Certificates'));

/* ------------------------------- developer ------------------------------- */
const DeveloperDashboard = lazy(() => import('../developer/Dashboard'));
const Analytics = lazy(() => import('../developer/Analytics'));
const Participants = lazy(() => import('../developer/Participants'));
const AntiCheatSettings = lazy(() => import('../developer/AntiCheatSettings'));

/* --------------------------------- admin --------------------------------- */
const AdminDashboard = lazy(() => import('../admin/AdminDashboard'));
const UsersManager = lazy(() => import('../admin/UsersManager'));
const Colleges = lazy(() => import('../admin/Colleges'));
const PlansManager = lazy(() => import('../admin/PlansManager'));
const CoursesManager = lazy(() => import('../admin/CoursesManager'));
const CourseForm = lazy(() => import('../admin/CourseForm'));
const EnrolledStudents = lazy(() => import('../admin/EnrolledStudents'));
const CategoriesManager = lazy(() => import('../admin/CategoriesManager'));
const ModulesManager = lazy(() => import('../admin/ModulesManager'));
const NotesManager = lazy(() => import('../admin/NotesManager'));
const AchievementsManager = lazy(() => import('../admin/AchievementsManager'));
const NotificationsManager = lazy(() => import('../admin/NotificationsManager'));
const SettingsManager = lazy(() => import('../admin/SettingsManager'));
const LandingBuilder = lazy(() => import('../admin/LandingBuilder'));
const ReportsManager = lazy(() => import('../admin/ReportsManager'));
const LeaderboardManager = lazy(() => import('../admin/LeaderboardManager'));
const PointsManager = lazy(() => import('../admin/PointsManager'));
const PagesManager = lazy(() => import('../admin/PagesManager'));
const UpiPayments = lazy(() => import('../admin/UpiPayments'));
const AIGenerator = lazy(() => import('../admin/AIGenerator'));
const CertificatesManager = lazy(() => import('../admin/CertificatesManager'));
const Plagiarism = lazy(() => import('../admin/Plagiarism'));
const FeatureControl = lazy(() => import('../admin/FeatureControl'));
const ProctorTest = lazy(() => import('../admin/ProctorTest'));
import FeatureGate from '../components/FeatureGate';

/* ------------------------- shared feature managers ------------------------- */
const QuizzesManager = lazy(() => import('../quiz/QuizzesManager'));
const QuizBuilder = lazy(() => import('../quiz/QuizBuilder'));
const LiveHostPanel = lazy(() => import('../quiz/LiveHostPanel'));
const ProblemsManager = lazy(() => import('../coding/ProblemsManager'));
const ContestsManager = lazy(() => import('../coding/ContestsManager'));
const SubmissionsManager = lazy(() => import('../coding/SubmissionsManager'));
const TestCasesOverview = lazy(() => import('../coding/TestCasesOverview'));

const RouteFallback = () => (
  <div className="route-loader" role="status" aria-live="polite">
    <div className="spinner" aria-hidden="true" /><span>Loading workspace…</span>
  </div>
);

export default function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
      {/* ---------------------------- public site ---------------------------- */}
      <Route element={<MainLayout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/courses" element={<Courses />} />
        <Route path="/courses/:id" element={<CourseDetail />} />
        <Route path="/notes" element={<Notes />} />
        <Route path="/quizzes" element={<FeatureGate setting="quiz_system_enabled" label="Quiz system"><Quizzes /></FeatureGate>} />
        <Route path="/interviews" element={<MockInterviews />} />
        <Route path="/quizzes/:id" element={<FeatureGate setting="quiz_system_enabled" label="Quiz system"><QuizDetail /></FeatureGate>} />
        <Route path="/coding" element={<FeatureGate setting="coding_system_enabled" label="Coding arena"><CodingArena /></FeatureGate>} />
        <Route path="/coding/:id" element={<FeatureGate setting="coding_system_enabled" label="Coding arena"><ProblemDetail /></FeatureGate>} />
        <Route path="/contests" element={<FeatureGate setting="contests_enabled" label="Contests"><Contests /></FeatureGate>} />
        <Route path="/contests/:id" element={<FeatureGate setting="contests_enabled" label="Contests"><ContestDetail /></FeatureGate>} />
        <Route path="/leaderboard" element={<FeatureGate setting="leaderboard_enabled" label="Leaderboard"><Leaderboard /></FeatureGate>} />
        <Route path="/about" element={<About />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/subscription" element={<ProtectedRoute><Subscription /></ProtectedRoute>} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/search" element={<SearchResults />} />
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/cert/:token" element={<VerifyCert />} />
        <Route path="/verify-certificate" element={<VerifyCertificateSearch />} />
        <Route path="/faq" element={<Faq />} />
        <Route path="/help" element={<Faq />} />
        <Route path="/terms" element={<SitePage />} />
        <Route path="/privacy" element={<SitePage />} />
        <Route path="/refund" element={<SitePage />} />
        <Route path="/cookies" element={<SitePage />} />
        <Route path="/disclaimer" element={<SitePage />} />
        <Route path="/accessibility" element={<SitePage />} />
        <Route path="/code-of-conduct" element={<SitePage />} />
        <Route path="/p/:slug" element={<SitePage />} />
        <Route path="/landing-preview" element={<ProtectedRoute roles={['admin']}><Landing preview /></ProtectedRoute>} />
        <Route path="*" element={<NotFound />} />
      </Route>

      {/* ------------------------- quiz attempts (auth) ------------------------- */}
      <Route path="/quizzes/:id/live" element={<ProtectedRoute roles={['student']}><FeatureGate setting="live_quiz_enabled" label="Live quizzes"><LiveQuiz /></FeatureGate></ProtectedRoute>} />
      <Route path="/quizzes/:id/attempt/:attemptId" element={<ProtectedRoute roles={['student']}><QuizAttempt /></ProtectedRoute>} />
      <Route path="/quizzes/attempts/:attemptId" element={<ProtectedRoute><QuizAttempt /></ProtectedRoute>} />
      <Route path="/proctor/second-camera/:token" element={<SecondCamera />} />

      {/* -------------------------------- auth -------------------------------- */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/auth/callback" element={<OAuthCallback />} />

      {/* ------------------------------- student ------------------------------- */}
      <Route path="/student" element={<ProtectedRoute roles={['student']}><DashboardLayout /></ProtectedRoute>}>
        <Route index element={<StudentDashboard />} />
        <Route path="courses" element={<MyCourses />} />
        <Route path="achievements" element={<FeatureGate setting="achievements_enabled" label="Achievements"><StudentAchievements /></FeatureGate>} />
        <Route path="results" element={<StudentResults />} />
        <Route path="certificates" element={<MyCertificates />} />
      </Route>

      {/* ------------------------------ developer ------------------------------ */}
      <Route path="/developer" element={<ProtectedRoute roles={['developer', 'admin']}><DashboardLayout /></ProtectedRoute>}>
        <Route index element={<DeveloperDashboard />} />
        <Route path="courses" element={<CoursesManager scope="developer" />} />
        <Route path="courses/new" element={<ProtectedRoute permission="create_course"><CourseForm scope="developer" /></ProtectedRoute>} />
        <Route path="courses/:id" element={<ProtectedRoute permission="edit_course"><CourseForm scope="developer" /></ProtectedRoute>} />
        <Route path="courses/:id/enrollments" element={<ProtectedRoute permission="view_student_data"><EnrolledStudents scope="developer" /></ProtectedRoute>} />
        <Route path="notes" element={<ProtectedRoute permission="upload_notes"><NotesManager scope="developer" /></ProtectedRoute>} />
        <Route path="quizzes" element={<QuizzesManager scope="developer" />} />
        <Route path="quiz/new" element={<Navigate to="/developer/quizzes" replace />} />
        <Route path="quizzes/:id" element={<ProtectedRoute permission="create_quiz"><QuizBuilder scope="developer" /></ProtectedRoute>} />
        <Route path="live" element={<ProtectedRoute permission="host_quiz"><LiveHostPanel scope="developer" /></ProtectedRoute>} />
        <Route path="live/:id" element={<ProtectedRoute permission="host_quiz"><LiveHostPanel scope="developer" /></ProtectedRoute>} />
        <Route path="problems" element={<ProtectedRoute permission="create_problem"><ProblemsManager scope="developer" /></ProtectedRoute>} />
        <Route path="problems/new" element={<Navigate to="/developer/problems" replace />} />
        <Route path="test-cases" element={<ProtectedRoute permission="create_problem"><TestCasesOverview scope="developer" /></ProtectedRoute>} />
        <Route path="contests" element={<ProtectedRoute permission="create_contest"><ContestsManager scope="developer" /></ProtectedRoute>} />
        <Route path="participants" element={<ProtectedRoute permission="view_student_data"><Participants /></ProtectedRoute>} />
        <Route path="submissions" element={<ProtectedRoute permission="view_submissions"><SubmissionsManager scope="developer" /></ProtectedRoute>} />
        <Route path="analytics" element={<ProtectedRoute permission="view_student_data"><Analytics /></ProtectedRoute>} />
        <Route path="plagiarism" element={<ProtectedRoute permission="view_submissions"><Plagiarism scope="developer" /></ProtectedRoute>} />
        <Route path="anti-cheating" element={<ProtectedRoute permission="manage_anticheat"><AntiCheatSettings /></ProtectedRoute>} />
      </Route>

      {/* -------------------------------- admin -------------------------------- */}
      <Route path="/admin" element={<ProtectedRoute roles={['admin']}><DashboardLayout /></ProtectedRoute>}>
        <Route index element={<AdminDashboard />} />
        <Route path="users" element={<UsersManager />} />
        <Route path="students" element={<UsersManager defaultRole="student" />} />
        <Route path="developers" element={<UsersManager defaultRole="developer" />} />
        <Route path="colleges" element={<Colleges />} />
        <Route path="plans" element={<PlansManager />} />
        <Route path="courses" element={<CoursesManager scope="admin" />} />
        <Route path="courses/new" element={<CourseForm scope="admin" />} />
        <Route path="courses/:id" element={<CourseForm scope="admin" />} />
        <Route path="courses/:id/enrollments" element={<EnrolledStudents scope="admin" />} />
        <Route path="categories" element={<CategoriesManager scope="admin" />} />
        <Route path="modules" element={<ModulesManager scope="admin" />} />
        <Route path="notes" element={<NotesManager scope="admin" />} />
        <Route path="quizzes" element={<QuizzesManager scope="admin" />} />
        <Route path="quizzes/:id" element={<QuizBuilder scope="admin" />} />
        <Route path="live" element={<LiveHostPanel scope="admin" />} />
        <Route path="live/:id" element={<LiveHostPanel scope="admin" />} />
        <Route path="problems" element={<ProblemsManager scope="admin" />} />
        <Route path="test-cases" element={<TestCasesOverview scope="admin" />} />
        <Route path="contests" element={<ContestsManager scope="admin" />} />
        <Route path="submissions" element={<SubmissionsManager scope="admin" />} />
        <Route path="plagiarism" element={<Plagiarism scope="admin" />} />
        <Route path="leaderboard" element={<LeaderboardManager />} />
        <Route path="points" element={<PointsManager />} />
        <Route path="pages" element={<PagesManager />} />
        <Route path="upi-payments" element={<UpiPayments />} />
        <Route path="achievements" element={<AchievementsManager scope="admin" />} />
        <Route path="notifications" element={<NotificationsManager />} />
        <Route path="reports" element={<ReportsManager />} />
        <Route path="landing-builder" element={<LandingBuilder />} />
        <Route path="settings" element={<SettingsManager />} />
        <Route path="features" element={<FeatureControl />} />
        <Route path="proctor-test" element={<ProctorTest />} />
        <Route path="certificates" element={<CertificatesManager />} />
        <Route path="ai" element={<AIGenerator />} />
        <Route path="profile" element={<Profile />} />
      </Route>

      <Route path="/403" element={<NotFound forbidden />} />
      <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
