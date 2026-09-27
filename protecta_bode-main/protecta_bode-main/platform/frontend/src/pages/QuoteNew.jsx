import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, ugx } from '../api.js'

const MIN = 1_000_000
const MAX = 300_000_000
const RATE = 0.015

// The landing page's calculator, wired to the real quote API.
export default function QuoteNew() {
  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  const initialValue = Number(searchParams.get('value'))
  const startingValue = initialValue >= MIN && initialValue <= MAX ? initialValue : 30_000_000
  const [value, setValue] = useState(startingValue)
  const [plate, setPlate] = useState('')
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [year, setYear] = useState(2015)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const premium = Math.round(value * RATE)
  const ok = value >= MIN && value <= MAX

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const q = await api('POST', '/quotes', {
        vehicle: { plate, make, model, year: Number(year), value },
      })
      nav(`/quote/${q.reference}`)
    } catch (err) {
      setError(err.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--orange)' }}>
        Premium calculator
      </span>
      <h1 style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 26, color: 'var(--navy)', margin: '8px 0 16px' }}>
        Calculate your premium
      </h1>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="carValue">Your car's value</label>
          <div className="money">
            <span>UGX</span>
            <input id="carValue" inputMode="numeric" value={value.toLocaleString('en-UG')}
                   onChange={(e) => setValue(Number(e.target.value.replace(/\D/g, '')) || 0)} />
          </div>
          <input type="range" min={MIN} max={MAX} step={500_000} value={Math.min(value, MAX)}
                 onChange={(e) => setValue(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--orange)', marginTop: 10 }} />
        </div>
        <div className="result-band">
          <div className="amount">{ugx(premium)}<small> / year</small></div>
          <div className="meta">{ok ? '1.5% of your car value. Car body, third party and driver cover.' : `Enter a value between ${ugx(MIN)} and ${ugx(MAX)}.`}</div>
        </div>

        <div className="grid c2" style={{ marginTop: 18 }}>
          <div className="field">
            <label htmlFor="plate">Number plate</label>
            <input id="plate" placeholder="UAA 123A" value={plate} required
                   onChange={(e) => setPlate(e.target.value.toUpperCase())} />
          </div>
          <div className="field">
            <label htmlFor="year">Year</label>
            <input id="year" type="number" min="1980" max="2027" value={year}
                   onChange={(e) => setYear(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="make">Make</label>
            <input id="make" placeholder="Toyota" value={make} required onChange={(e) => setMake(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="model">Model</label>
            <input id="model" placeholder="Premio" value={model} required onChange={(e) => setModel(e.target.value)} />
          </div>
        </div>
        {error && <p style={{ color: 'var(--error)', marginBottom: 10 }}>{error}</p>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy || !ok}>
          {busy ? 'Preparing...' : 'Get this quote'}
          <i className="hgi-stroke hgi-arrow-right-01" aria-hidden="true" />
        </button>
      </form>
    </div>
  )
}
