import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

const RATE = 0.015
const MIN_VALUE = 1_000_000
const RANGE_MIN = 5_000_000
const MAX_VALUE = 300_000_000
const DEFAULT_VALUE = 30_000_000

const money = (amount) => `UGX ${Math.round(Number(amount) || 0).toLocaleString('en-UG')}`
const clamp = (number, min, max) => Math.min(max, Math.max(min, number))

export default function Landing() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryValue = Number(searchParams.get('value'))
  const initialValue = queryValue >= MIN_VALUE && queryValue <= MAX_VALUE ? queryValue : DEFAULT_VALUE
  const [value, setValue] = useState(initialValue)
  const premium = Math.round(value * RATE)
  const valid = value >= MIN_VALUE && value <= MAX_VALUE
  const sliderValue = clamp(value || RANGE_MIN, RANGE_MIN, MAX_VALUE)
  const sliderProgress = ((sliderValue - RANGE_MIN) / (MAX_VALUE - RANGE_MIN)) * 100

  function updateValue(rawValue) {
    const next = Number(String(rawValue).replace(/\D/g, '')) || 0
    setValue(clamp(next, 0, MAX_VALUE))
  }

  function continueToQuote() {
    if (valid) navigate(`/quote?value=${value}`)
  }

  return (
    <main className="original-stage">
      <section className="original-key-visual" aria-label="Protecta Bode campaign">
        <div className="original-key-visual-frame">
          <picture>
            <source
              type="image/webp"
              srcSet="/assets/key-visual-720.webp 720w, /assets/key-visual-1080.webp 1080w, /assets/key-visual-1600.webp 1600w"
              sizes="(min-width: 1024px) and (min-aspect-ratio: 5/4) 86svh, 100vw"
            />
            <img
              src="/assets/key-visual-1080.jpg"
              srcSet="/assets/key-visual-720.jpg 720w, /assets/key-visual-1080.jpg 1080w, /assets/key-visual-1600.jpg 1600w"
              sizes="(min-width: 1024px) and (min-aspect-ratio: 5/4) 86svh, 100vw"
              width="1080"
              height="1259"
              fetchPriority="high"
              decoding="async"
              alt="Protecta Bode by Liberty. Cover your ride, cover your life, with car body, third party and driver cover."
            />
          </picture>
          <a className="original-key-visual-call" href="tel:+256312246500" aria-label="Call Protecta Bode on 0312 246500" />
        </div>
      </section>

      <section className="original-panel" aria-label="Protecta Bode premium calculator">
        <div className="original-panel-inner">
          <header className="original-toolbar">
            <img src="/protecta-bode-logo.svg" alt="Protecta Bode by Liberty General Insurance" />
            <Link className="original-signin" to="/login">Portal sign in <span aria-hidden="true">→</span></Link>
          </header>

          <div className="original-card">
            <div className="original-card-body">
              <span className="original-eyebrow"><ShieldIcon filled />Premium calculator</span>
              <h1 className="original-title">Calculate your premium</h1>
              <p className="original-lede">For just <b>1.5%</b> of your car’s value, you enjoy car body, third party, and driver cover in case of an accident.</p>

              <div className="original-calculator">
                <label className="original-field-label" htmlFor="landing-car-value">Your car’s value</label>
                <div className="original-money">
                  <span aria-hidden="true">UGX</span>
                  <input
                    id="landing-car-value"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={value ? value.toLocaleString('en-UG') : ''}
                    placeholder="0"
                    aria-describedby="landing-value-help"
                    onChange={(event) => updateValue(event.target.value)}
                  />
                </div>
                <div className="original-range-wrap">
                  <input
                    className="original-range"
                    type="range"
                    min={RANGE_MIN}
                    max={MAX_VALUE}
                    step={500_000}
                    value={sliderValue}
                    aria-label="Car value slider"
                    style={{ '--range-progress': `${sliderProgress}%` }}
                    onChange={(event) => setValue(Number(event.target.value))}
                  />
                  <div className="original-range-scale" aria-hidden="true"><span>5M</span><span>300M+</span></div>
                </div>
                <p className="sr-only" id="landing-value-help">Enter the current market value of your car in Uganda shillings.</p>

                <div className={`original-result${valid ? '' : ' is-empty'}`} aria-live="polite">
                  <span className="original-result-label">Your annual premium</span>
                  <div className="original-result-amount"><span className="original-currency">UGX</span>{valid ? premium.toLocaleString('en-UG') : '0'}<small>/ year</small></div>
                  <span className="original-result-rate" aria-label="rate 1.5 percent">1.5%</span>
                  <span className="original-result-meta">
                    {valid ? `1.5% of ${money(value)}` : `Enter your car’s value (from ${money(MIN_VALUE)}) to see your premium.`}
                  </span>
                </div>

                <ul className="original-covers" aria-label="What you are covered for">
                  <li><ShieldIcon />Car body</li>
                  <li><ShieldIcon orange />Third party</li>
                  <li><ShieldIcon />Driver cover</li>
                </ul>

                <button className="original-cta" type="button" onClick={continueToQuote} disabled={!valid}>
                  Proceed with this cover <ArrowIcon />
                </button>
                <div className="original-after">
                  <span>Terms and Conditions apply</span>
                  <a href="tel:+256312246500">Call 0312 246500</a>
                </div>
              </div>
            </div>
          </div>
          <p className="original-underwriting">Protecta Bode is underwritten by Liberty General Insurance Uganda and regulated by the Insurance Regulatory Authority of Uganda.</p>
        </div>
        <div className="original-panel-band" aria-hidden="true" />
      </section>
    </main>
  )
}

function ShieldIcon({ filled = false, orange = false }) {
  return (
    <svg className={orange ? 'orange' : ''} viewBox="0 0 30 34" aria-hidden="true">
      <path
        d="M15 1.5 2.5 6v9.2c0 8 5.3 14.3 12.5 17.3 7.2-3 12.5-9.3 12.5-17.3V6L15 1.5Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11m-4.5-5 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
