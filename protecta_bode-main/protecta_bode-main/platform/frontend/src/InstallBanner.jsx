import { useEffect, useState } from 'react'

// First-visit install banner (top of screen). Modern browsers no longer show
// an automatic banner: Chrome fires `beforeinstallprompt` and we render our
// own; iOS gets Share > Add to Home Screen instructions. Dismissal is
// remembered for 14 days.
const DISMISS_KEY = 'pb_install_dismissed_at'
const DISMISS_DAYS = 14

export default function InstallBanner() {
  const [deferred, setDeferred] = useState(null)
  const [visible, setVisible] = useState(false)
  const [ios, setIos] = useState(false)

  useEffect(() => {
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0)
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_DAYS * 864e5) return

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const standalone = window.matchMedia('(display-mode: standalone)').matches
                   || navigator.standalone === true
    if (standalone) return                       // already installed: never nag
    setIos(isIOS)

    const onBip = (e) => { e.preventDefault(); setDeferred(e); setVisible(true) }
    const onInstalled = () => setVisible(false)
    window.addEventListener('beforeinstallprompt', onBip)
    window.addEventListener('appinstalled', onInstalled)
    // iOS fallback: no prompt event exists; offer instructions after a short pause
    const t = setTimeout(() => { if (isIOS) setVisible(true) }, 2500)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip)
      window.removeEventListener('appinstalled', onInstalled)
      clearTimeout(t)
    }
  }, [])

  const dismiss = () => {
    setVisible(false)
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  }

  const install = async () => {
    if (!deferred) return
    deferred.prompt()
    await deferred.userChoice
    setVisible(false)
  }

  if (!visible) return null
  return (
    <div role="region" aria-label="Install app"
         style={{ position: 'sticky', top: 0, zIndex: 60, background: 'var(--sky-soft)',
                  color: 'var(--navy)', padding: '9px 16px', display: 'flex', gap: 12,
                  alignItems: 'center', justifyContent: 'space-between',
                  flexWrap: 'wrap', borderBottom: '1px solid var(--sky-line)' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12.5 }}>
        <img src="/protecta-bode-logo.svg" alt="Protecta Bode" width={104} height={58} style={{ objectFit: 'contain' }} />
        {ios
          ? <span>Install Protecta Bode: tap <b>Share</b>, then <b>Add to Home Screen</b>.</span>
          : <span>Install the Protecta Bode app for faster access and offline start.</span>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {!ios && (
          <button className="btn primary" style={{ padding: '7px 16px', fontSize: 11 }}
                  onClick={install}>Install</button>
        )}
        <button className="btn ghost" style={{ padding: '7px 12px', fontSize: 11 }}
                onClick={dismiss}>Later</button>
      </div>
    </div>
  )
}
