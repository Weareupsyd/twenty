import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Layout } from './components/layout/Layout'

// Keep the shell and route table in the initial chunk. Pages are loaded only
// when visited so the developer portal does not make every hosted/verification
// screen part of the first download.
const DeveloperPage = lazy(() => import('./pages/DeveloperPage').then(({ DeveloperPage }) => ({ default: DeveloperPage })))
const DemoPage = lazy(() => import('./pages/DemoPage').then(({ DemoPage }) => ({ default: DemoPage })))
const UserVerificationPage = lazy(() => import('./pages/UserVerificationPage'))
const PageBuilderPage = lazy(() => import('./pages/PageBuilderPage'))
const LiveCapturePage = lazy(() => import('./pages/LiveCapturePage').then(({ LiveCapturePage }) => ({ default: LiveCapturePage })))
const MobileVerificationPage = lazy(() => import('./pages/MobileVerificationPage'))
const AdminLogin = lazy(() => import('./pages/AdminLogin').then(({ AdminLogin }) => ({ default: AdminLogin })))
const VerificationManagement = lazy(() => import('./pages/VerificationManagement').then(({ VerificationManagement }) => ({ default: VerificationManagement })))
const DevelopersList = lazy(() => import('./pages/DevelopersList').then(({ DevelopersList }) => ({ default: DevelopersList })))
const BusinessVerification = lazy(() => import('./pages/BusinessVerification'))
const BusinessVerificationFlow = lazy(() => import('./pages/BusinessVerificationFlow'))
const KybWorkflowSettings = lazy(() => import('./pages/KybWorkflowSettings'))
const DocsPage = lazy(() => import('./pages/DocsPage').then(({ DocsPage }) => ({ default: DocsPage })))
const DocsGuides = lazy(() => import('./pages/DocsGuides').then(({ DocsGuides }) => ({ default: DocsGuides })))
const DocsSdk = lazy(() => import('./pages/DocsSdk').then(({ DocsSdk }) => ({ default: DocsSdk })))
const DocsFeatures = lazy(() => import('./pages/DocsFeatures').then(({ DocsFeatures }) => ({ default: DocsFeatures })))
const DocsReference = lazy(() => import('./pages/DocsReference').then(({ DocsReference }) => ({ default: DocsReference })))
const ReviewDashboardDocs = lazy(() => import('./pages/ReviewDashboardDocs').then(({ ReviewDashboardDocs }) => ({ default: ReviewDashboardDocs })))
const MarkdownDocsPage = lazy(() => import('./pages/MarkdownDocsPage').then(({ MarkdownDocsPage }) => ({ default: MarkdownDocsPage })))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then(({ NotFoundPage }) => ({ default: NotFoundPage })))
const LegalPage = lazy(() => import('./pages/LegalPage').then(({ LegalPage }) => ({ default: LegalPage })))
const SetupPage = lazy(() => import('./pages/SetupPage').then(({ SetupPage }) => ({ default: SetupPage })))
const VerifyCredentialPage = lazy(() => import('./pages/VerifyCredentialPage').then(({ VerifyCredentialPage }) => ({ default: VerifyCredentialPage })))
const PublicQrPage = lazy(() => import('./pages/PublicQrPage'))
const StartVerificationPage = lazy(() => import('./pages/StartVerificationPage'))

function RouteFallback() {
  return <div className="page-loading" role="status">Loading…</div>
}

function App() {
  return (
    <ErrorBoundary>
      <Layout>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Root route: Dev Portal */}
            <Route path="/" element={<DeveloperPage />} />

            {/* Dev Portal */}
            <Route path="/developer" element={<DeveloperPage />} />

            {/* Live verification (formerly the demo page) */}
            <Route path="/live-verification" element={<DemoPage />} />
            <Route path="/demo" element={<DemoPage />} />
            <Route path="/qr" element={<PublicQrPage />} />
            <Route path="/start" element={<StartVerificationPage />} />
            <Route path="/verify" element={<Navigate to="/live-verification" replace />} />
            <Route path="/verify-credential" element={<VerifyCredentialPage />} />

            {/* Shared routes */}
            <Route path="/user-verification" element={<UserVerificationPage />} />
            <Route path="/v/:slug" element={<UserVerificationPage />} />
            <Route path="/b/:token" element={<BusinessVerificationFlow />} />
            <Route path="/developer/page-builder" element={<PageBuilderPage />} />
            <Route path="/live-capture" element={<LiveCapturePage />} />
            <Route path="/verify/mobile" element={<MobileVerificationPage />} />
            <Route path="/docs/markdown" element={<MarkdownDocsPage />} />
            <Route path="/docs/review" element={<ReviewDashboardDocs />} />
            <Route path="/docs/guides" element={<DocsGuides />} />
            <Route path="/docs/sdk" element={<DocsSdk />} />
            <Route path="/docs/features" element={<DocsFeatures />} />
            <Route path="/docs/reference" element={<DocsReference />} />
            <Route path="/docs" element={<DocsPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/legal" element={<LegalPage />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin/verifications" element={<VerificationManagement />} />
            <Route path="/admin/developers" element={<DevelopersList />} />
            <Route path="/admin/business" element={<BusinessVerification />} />
            <Route path="/admin/business/workflows" element={<KybWorkflowSettings />} />
            <Route path="/admin/business/workflows/:workflowId" element={<KybWorkflowSettings />} />
            <Route path="/admin/*" element={<Navigate to="/admin/verifications" replace />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </Layout>
    </ErrorBoundary>
  )
}

export default App
