/* Protecta Bode mockups — shared interactions (vanilla JS, no build step) */

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v
    else if (k === 'html') el.innerHTML = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (v !== null && v !== undefined) el.setAttribute(k, v)
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue
    el.append(kid.nodeType ? kid : document.createTextNode(kid))
  }
  return el
}

function ico(name, cls = '') {
  return h('i', { class: `hgi-stroke hgi-${name} ${cls}`.trim(), 'aria-hidden': 'true' })
}

/* ── Toast ── */
let toastTimer
function toast(message) {
  let el = document.querySelector('.toast')
  if (!el) {
    el = h('div', { class: 'toast', role: 'status' }, ico('checkmark-circle-01'), h('span'))
    document.body.append(el)
  }
  el.querySelector('span').textContent = message
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600)
}

/* ── Backdrop shared by drawers / panels ── */
function ensureBackdrop(onClick) {
  let bd = document.querySelector('.backdrop')
  if (!bd) {
    bd = h('div', { class: 'backdrop' })
    document.body.append(bd)
  }
  /* Always attach: one backdrop may serve the drawer and the notifications panel */
  if (onClick) bd.addEventListener('click', onClick)
  return bd
}

/* ── Profile menu (top bar) ── */
function initProfileMenu() {
  const btn = document.querySelector('[data-profile-btn]')
  const menu = document.querySelector('[data-profile-menu]')
  if (!btn || !menu) return
  menu.hidden = true
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    menu.hidden = !menu.hidden
  })
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true
  })
}

/* ── Switches (settings toggles) ── */
function initSwitches() {
  document.querySelectorAll('.switch').forEach((sw) => {
    sw.addEventListener('click', () => {
      const on = sw.getAttribute('aria-checked') === 'true'
      sw.setAttribute('aria-checked', String(!on))
      sw.querySelector('.hgi-stroke').className = `hgi-stroke hgi-toggle-${!on ? 'on' : 'off'}`
      toast(`${sw.dataset.label || 'Preference'} ${!on ? 'enabled' : 'disabled'}`)
    })
  })
}

/* ── Modal ── */
function initModal() {
  const wrap = document.querySelector('.modal-wrap')
  if (!wrap) return
  const openers = document.querySelectorAll('[data-modal-open]')
  const closers = wrap.querySelectorAll('[data-modal-close]')
  const close = () => wrap.classList.remove('show')
  openers.forEach((b) => b.addEventListener('click', () => wrap.classList.add('show')))
  closers.forEach((b) => b.addEventListener('click', close))
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })
  /* OTP auto-advance */
  const slots = [...wrap.querySelectorAll('.otp-slots input')]
  slots.forEach((inp, i) => {
    inp.addEventListener('input', () => {
      const d = inp.value.replace(/\D/g, '').slice(-1)
      inp.value = d
      if (d && i < slots.length - 1) slots[i + 1].focus()
    })
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !inp.value && i > 0) slots[i - 1].focus()
    })
    inp.addEventListener('paste', (e) => {
      const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6)
      if (!digits) return
      e.preventDefault()
      digits.split('').forEach((d, k) => { if (slots[i + k]) slots[i + k].value = d })
      slots[Math.min(i + digits.length, 5)].focus()
    })
  })
}

/* ── Notifications slide-over ── */
function initNotifications() {
  const panel = document.querySelector('.notif-panel')
  if (!panel) return
  const bd = ensureBackdrop(closeAll)
  const openers = document.querySelectorAll('[data-notif-open]')
  const closers = panel.querySelectorAll('[data-notif-close]')
  function closeAll() {
    panel.classList.remove('show')
    bd.classList.remove('show')
  }
  openers.forEach((b) => b.addEventListener('click', () => {
    panel.classList.add('show')
    bd.classList.add('show')
  }))
  closers.forEach((b) => b.addEventListener('click', closeAll))
  const markAll = panel.querySelector('[data-mark-all]')
  if (markAll) markAll.addEventListener('click', () => {
    panel.querySelectorAll('.notif-row.unread').forEach((r) => {
      r.classList.remove('unread')
      r.querySelector('.notif-unread-dot')?.remove()
    })
    document.querySelectorAll('[data-notif-badge]').forEach((b) => { b.hidden = true })
    toast('All notifications marked as read')
  })
}
