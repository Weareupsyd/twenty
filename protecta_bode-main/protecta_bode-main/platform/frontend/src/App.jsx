import { Navigate, Route, Routes, Link, useLocation } from 'react-router-dom'
import { session, clearSession } from './api.js'
import InstallBanner from './InstallBanner.jsx'
import Landing from './pages/Landing.jsx'
import Login from './pages/Login.jsx'
import QuoteNew from './pages/QuoteNew.jsx'
import QuotePay from './pages/QuotePay.jsx'
import Policies from './pages/Policies.jsx'
import Claims from './pages/Claims.jsx'
import Kyc from './pages/Kyc.jsx'
import Agent from './pages/Agent.jsx'
import Broker from './pages/Broker.jsx'
import Admin from './pages/Admin.jsx'
import AdminPayments from './pages/AdminPayments.jsx'
import AdminClaims from './pages/AdminClaims.jsx'
import AdminBrokers from './pages/AdminBrokers.jsx'
import AdminPolicies from './pages/AdminPolicies.jsx'
import AdminReports from './pages/AdminReports.jsx'
import Commissions from './pages/Commissions.jsx'
import Helpdesk from './pages/Helpdesk.jsx'
import Payments from './pages/Payments.jsx'
import Support from './pages/Support.jsx'
import UserAccess from './pages/UserAccess.jsx'
import Integrations from './pages/Integrations.jsx'

const STAFF = ['admin', 'underwriter', 'claims_handler']
const ROLE_NAME = {
  customer: 'customer portal',
  agent: 'agent portal',
  broker: 'broker portal',
  admin: 'operations console',
  underwriter: 'operations console',
  claims_handler: 'operations console',
}

function RequireRole({ roles, children }) {
  const { role } = session()
  if (!role) return <Navigate to="/login" replace />
  if (roles && !roles.includes(role)) return <Navigate to="/" replace />
  return children
}

function NavItem({ to, icon, label, end }) {
  const loc = useLocation()
  const active = end ? loc.pathname === to : loc.pathname.startsWith(to)
  return (
    <Link className={`nav-item${active ? ' active' : ''}`} to={to} aria-current={active ? 'page' : undefined}>
      <i className={`hgi-stroke ${icon}`} aria-hidden="true" />
      <span>{label}</span>
    </Link>
  )
}

function Shell({ children }) {
  const { role, name } = session()
  const home = role === 'customer' ? '/app' : role === 'agent' ? '/agent' : role === 'broker' ? '/broker' : '/admin'
  const displayName = name || role || 'User'
  const initials = displayName.trim().slice(0, 1).toUpperCase()

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to={home} className="side-logo" aria-label="Protecta Bode home">
          <img src="/protecta-bode-logo.svg" alt="Protecta Bode by Liberty General Insurance" />
        </Link>
        <nav className="side-nav" aria-label="Portal navigation">
          <span className="side-label">Workspace</span>
          {role === 'customer' && (
            <>
              <NavItem to="/app" icon="hgi-home-01" label="My cover" end />
              <NavItem to="/app/payments" icon="hgi-wallet-01" label="Payments" />
              <NavItem to="/app/claims" icon="hgi-accident" label="Claims" />
              <NavItem to="/app/kyc" icon="hgi-user-verification" label="Verify identity" />
              <NavItem to="/app/support" icon="hgi-customer-support" label="Support" />
              <NavItem to="/quote" icon="hgi-insurance" label="New quote" />
            </>
          )}
          {role === 'agent' && (
            <>
              <NavItem to="/agent" icon="hgi-briefcase-01" label="My book" end />
              <NavItem to="/commissions" icon="hgi-wallet-01" label="Commissions" />
              <NavItem to="/app/support" icon="hgi-customer-support" label="Support" />
              <NavItem to="/quote" icon="hgi-insurance" label="New quote" />
            </>
          )}
          {role === 'broker' && (
            <>
              <NavItem to="/broker" icon="hgi-chart-upward" label="Performance" end />
              <NavItem to="/broker/tree" icon="hgi-user-multiple" label="Agents" />
              <NavItem to="/commissions" icon="hgi-wallet-01" label="Commissions" />
              <NavItem to="/app/support" icon="hgi-customer-support" label="Support" />
              <NavItem to="/quote" icon="hgi-insurance" label="New quote" />
            </>
          )}
          {STAFF.includes(role) && (
            <>
              <NavItem to="/admin" icon="hgi-dashboard-speed-01" label="Dashboard" end />
              <NavItem to="/admin/policies" icon="hgi-insurance" label="Policies" />
              <NavItem to="/admin/payments" icon="hgi-wallet-01" label="Payments" />
              <NavItem to="/admin/claims" icon="hgi-accident" label="Claims" />
              <NavItem to="/admin/brokers" icon="hgi-user-multiple" label="Distribution" />
              <NavItem to="/admin/helpdesk" icon="hgi-customer-support" label="Helpdesk" />
              <NavItem to="/admin/reports" icon="hgi-chart-upward" label="Reports" />
            </>
          )}
          {role === 'admin' && (
            <>
              <NavItem to="/admin/access" icon="hgi-user-multiple" label="User access" />
              <NavItem to="/admin/integrations" icon="hgi-link-01" label="Integrations" />
            </>
          )}
        </nav>
        <div className="side-foot">
          <div className="side-user">
            <span className="avatar" aria-hidden="true">{initials}</span>
            <span className="user-copy"><b>{displayName}</b><small>{role?.replace('_', ' ')}</small></span>
          </div>
          <p>Protecta Bode is underwritten by Liberty General Insurance Uganda.</p>
        </div>
      </aside>

      <div className="main-col">
        <header className="top">
          <div className="crumbs">
            <span>Protecta Bode</span><span className="sep">/</span>
            <span className="here">{ROLE_NAME[role] || 'portal'}</span>
          </div>
          <div className="top-actions">
            <span className="top-user">{displayName}</span>
            <Link className="btn ghost top-signout" to="/logout">Sign out <span aria-hidden="true">→</span></Link>
          </div>
        </header>
        <main className="main">{children}</main>
      </div>
    </div>
  )
}

function PublicFlow({ children }) {
  return (
    <div className="public-flow">
      <header className="public-flow-header">
        <Link to="/" className="public-flow-brand" aria-label="Back to Protecta Bode home">
          <img src="/protecta-bode-logo.svg" alt="Protecta Bode by Liberty General Insurance" />
        </Link>
        <a href="tel:+256312246500" className="public-flow-phone"><i className="hgi-stroke hgi-call" aria-hidden="true" /><span>Help: 0312 246500</span></a>
      </header>
      <main className="public-flow-content">{children}</main>
    </div>
  )
}

function Logout() {
  const location = useLocation()
  clearSession()
  const returnPath = new URLSearchParams(location.search).get('next') || '/'
  return <Navigate to="/login" replace state={{ from: returnPath }} />
}

function Home() {
  const { role } = session()
  if (!role) return <Landing />
  if (role === 'customer') return <Navigate to="/app" replace />
  if (role === 'agent') return <Navigate to="/agent" replace />
  if (role === 'broker') return <Navigate to="/broker" replace />
  return <Navigate to="/admin" replace />
}

export default function App() {
  return (
    <>
      <InstallBanner />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/logout" element={<Logout />} />
        {/* The public landing page remains the front door; quote requests use the live API. */}
        <Route path="/quote" element={<PublicFlow><QuoteNew /></PublicFlow>} />
        <Route path="/quote/:reference" element={<PublicFlow><QuotePay /></PublicFlow>} />
        <Route path="/" element={<Home />} />

        <Route path="/app" element={<RequireRole roles={['customer', 'agent', 'broker']}><Shell><Policies /></Shell></RequireRole>} />
        <Route path="/app/payments" element={<RequireRole roles={['customer']}><Shell><Payments /></Shell></RequireRole>} />
        <Route path="/app/claims" element={<RequireRole roles={['customer', 'agent', 'broker']}><Shell><Claims /></Shell></RequireRole>} />
        <Route path="/app/kyc" element={<RequireRole roles={['customer', 'agent', 'broker']}><Shell><Kyc /></Shell></RequireRole>} />
        <Route path="/app/support" element={<RequireRole roles={['customer', 'agent', 'broker']}><Shell><Support /></Shell></RequireRole>} />

        <Route path="/agent" element={<RequireRole roles={['agent']}><Shell><Agent /></Shell></RequireRole>} />
        <Route path="/broker" element={<RequireRole roles={['broker']}><Shell><Broker /></Shell></RequireRole>} />
        <Route path="/broker/tree" element={<RequireRole roles={['broker']}><Shell><AdminBrokers brokerView /></Shell></RequireRole>} />
        <Route path="/commissions" element={<RequireRole roles={['agent', 'broker']}><Shell><Commissions /></Shell></RequireRole>} />

        <Route path="/admin" element={<RequireRole roles={STAFF}><Shell><Admin /></Shell></RequireRole>} />
        <Route path="/admin/policies" element={<RequireRole roles={STAFF}><Shell><AdminPolicies /></Shell></RequireRole>} />
        <Route path="/admin/payments" element={<RequireRole roles={STAFF}><Shell><AdminPayments /></Shell></RequireRole>} />
        <Route path="/admin/claims" element={<RequireRole roles={STAFF}><Shell><AdminClaims /></Shell></RequireRole>} />
        <Route path="/admin/brokers" element={<RequireRole roles={STAFF}><Shell><AdminBrokers /></Shell></RequireRole>} />
        <Route path="/admin/helpdesk" element={<RequireRole roles={STAFF}><Shell><Helpdesk /></Shell></RequireRole>} />
        <Route path="/admin/reports" element={<RequireRole roles={STAFF}><Shell><AdminReports /></Shell></RequireRole>} />
        <Route path="/admin/access" element={<RequireRole roles={['admin']}><Shell><UserAccess /></Shell></RequireRole>} />
        <Route path="/admin/integrations" element={<RequireRole roles={['admin']}><Shell><Integrations /></Shell></RequireRole>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
