// =============================================================================
// IntakeScreen — hand the phone to the customer (FIELD-5)
// =============================================================================
// Paul: "a new lead tab where I can hand my phone or an iPad to the customer
// and they add their basic info." A full-screen kiosk flow that covers the
// entire field shell (header, nav, bell — a guest is holding the device):
//   Welcome → About you → Cemetery → Service → Who it honors → Review → Done.
// Writes through the EXACT desktop lead path (makeBlankOrder + saveOrder,
// status 'draft') so the lead lands in Leads/Sales like any first-call lead;
// salesRep is stamped with the staff member whose phone it is, and the intake
// leaves an order note saying the customer entered it themselves.
// Leaving the flow mid-entry (the discreet STAFF chip) and finishing the
// thank-you screen are staff actions: gated by the picked person's PIN when
// one is set, a deliberate two-tap when not. No money, no CRM data, no other
// customer's anything is reachable while the flow is up.
// =============================================================================
import { useState, useRef } from 'react'
import { makeBlankOrder, makeBlankDeceased, saveOrder, searchCemeteries, rowToCemetery } from '../SalesMode'
import { phoneDigits, addOrderNote } from '../lib/stonebooksData'

// Same codes the desktop NewLeadModal offers (orders.service_types vocabulary).
const SERVICES = [
  { code: 'NEW_STONE',   label: 'A new monument',            sub: 'A new stone for a loved one' },
  { code: 'INSCRIPTION', label: 'Add an inscription',        sub: 'Add a name or dates to an existing stone' },
  { code: 'REPAIR',      label: 'Repair',                    sub: 'Straighten, reset, or fix a monument' },
  { code: 'ACID_WASH',   label: 'Cleaning',                  sub: 'Professional cleaning of an existing stone' },
  { code: 'BRONZE',      label: 'Bronze',                    sub: 'Bronze marker or plaque work' },
  { code: 'MAUSOLEUM',   label: 'Mausoleum or crypt',        sub: 'Doors, crypt fronts, mausoleum work' },
  { code: '',            label: 'Not sure yet',              sub: 'Our staff will walk you through it' },
]

const STEPS = ['you', 'cemetery', 'service', 'people', 'review']

const blankPerson = () => ({ firstName: '', lastName: '', dateOfBirth: '', dateOfDeath: '', isPreNeed: false, relationship: '' })

// ── Staff gate — PIN when the picked person has one, two-tap when not ────────
function StaffGate({ who, label, onPass, onCancel }) {
  const [pin, setPin] = useState('')
  const [wrong, setWrong] = useState(false)
  const [armed, setArmed] = useState(false)

  if (!who?.pin) {
    return (
      <div className="fi-gate">
        <div className="fi-gate-box">
          <div className="fi-gate-title">{label}</div>
          <div className="fi-gate-sub">Staff only — {armed ? 'tap again to confirm.' : 'tap the button twice.'}</div>
          <div className="fi-gate-row">
            <button type="button" className="fl-btn fl-btn-ghost" onClick={onCancel}>Back</button>
            <button type="button" className={`fl-btn ${armed ? 'fl-btn-gold' : 'fl-btn-ghost'}`}
              onClick={() => { if (armed) onPass(); else setArmed(true) }}>
              {armed ? 'Confirm' : label}
            </button>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="fi-gate">
      <div className="fi-gate-box">
        <div className="fi-gate-title">{label}</div>
        <div className="fi-gate-sub">Enter {who.name}&#8217;s PIN</div>
        <input className="fl-pin-input" type="password" inputMode="numeric" autoFocus
          maxLength={4} value={pin} placeholder="&#8226;&#8226;&#8226;&#8226;"
          onChange={e => { setWrong(false); setPin(e.target.value.replace(/\D/g, '')) }}
          onKeyDown={e => {
            if (e.key !== 'Enter' || pin.length !== 4) return
            if (pin === String(who.pin)) onPass()
            else { setWrong(true); setPin('') }
          }} />
        {wrong && <div className="fi-err" style={{ marginTop: 8 }}>Wrong PIN — try again.</div>}
        <div className="fi-gate-row">
          <button type="button" className="fl-btn fl-btn-ghost" onClick={onCancel}>Back</button>
          <button type="button" className="fl-btn fl-btn-gold" disabled={pin.length !== 4}
            style={{ opacity: pin.length === 4 ? 1 : 0.5 }}
            onClick={() => { if (pin === String(who.pin)) onPass(); else { setWrong(true); setPin('') } }}>
            Open
          </button>
        </div>
      </div>
    </div>
  )
}

export default function IntakeScreen({ who, onClose, onOpenLead }) {
  const [step, setStep] = useState('welcome')   // welcome | you | cemetery | service | people | review | done
  const [gate, setGate] = useState(null)        // null | 'exit' | 'finish'

  // ── The customer's answers ────────────────────────────────────────────────
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [showAddr, setShowAddr] = useState(false)
  const [addr1, setAddr1] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('NJ')
  const [zip, setZip] = useState('')
  const [cemetery, setCemetery] = useState('')
  const [cemeteryId, setCemeteryId] = useState(null)
  const [cemResults, setCemResults] = useState([])
  const [service, setService] = useState(null)  // null = not answered; '' = not sure
  const [people, setPeople] = useState([blankPerson()])
  const [extra, setExtra] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [savedOrderId, setSavedOrderId] = useState(null)
  const cemTimer = useRef(null)

  const stepIdx = STEPS.indexOf(step)

  const onCemType = (v) => {
    setCemetery(v); setCemeteryId(null)
    if (cemTimer.current) clearTimeout(cemTimer.current)
    if (!v || !v.trim()) { setCemResults([]); return }
    cemTimer.current = setTimeout(() => {
      searchCemeteries(v).then(rows => setCemResults(rows || [])).catch(() => setCemResults([]))
    }, 220)
  }
  const pickCem = (row) => {
    const c = rowToCemetery(row)
    setCemetery(c.name || row.name || ''); setCemeteryId(c.id || row.id || null)
    setCemResults([])
  }

  const setPerson = (i, patch) =>
    setPeople(list => list.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))

  const canContinueYou = first.trim() && last.trim() && phoneDigits(phone).length >= 10
  const namedPeople = people.filter(p => p.firstName.trim() || p.lastName.trim())

  // ── Submit — the desktop lead path, verbatim ──────────────────────────────
  const submit = async () => {
    if (busy) return
    setBusy(true); setErr(null)
    const blank = makeBlankOrder()
    const cemName = cemetery.trim()
    const lead = {
      ...blank,
      status: 'draft',
      salesRep: who?.name || '',
      serviceTypes: service ? [service] : [],
      customer: {
        ...blank.customer,
        firstName: first.trim(),
        lastName: last.trim(),
        phonePrimary: phoneDigits(phone),
        email: email.trim(),
        addressLine1: addr1.trim(),
        city: city.trim(),
        state: state.trim() || 'NJ',
        zip: zip.trim(),
      },
      cemetery: cemName
        ? { ...blank.cemetery, id: cemeteryId || null, name: cemName }
        : blank.cemetery,
      deceased: namedPeople.length
        ? namedPeople.map((p, i) => ({
            ...makeBlankDeceased(i),
            firstName: p.firstName.trim(),
            lastName: p.lastName.trim() || last.trim(),
            dateOfBirth: p.dateOfBirth || '',
            dateOfDeath: p.isPreNeed ? '' : (p.dateOfDeath || ''),
            isPreNeed: !!p.isPreNeed,
            relationship: p.relationship.trim(),
          }))
        : blank.deceased,
    }
    const res = await saveOrder(lead)
    if (!res?.ok) {
      setBusy(false)
      setErr(res?.error?.message || res?.reason || 'Could not save — please hand the phone back to our staff.')
      return
    }
    const orderId = res.order?.id || null
    if (orderId) {
      const noteBits = [`Self-service intake — customer entered their own details on ${who?.name || 'a staff'}'s device.`]
      if (extra.trim()) noteBits.push(`Customer note: ${extra.trim()}`)
      await addOrderNote({ orderId, body: noteBits.join('\n'), author: who?.name || null }).catch(() => {})
    }
    setSavedOrderId(orderId)
    setBusy(false)
    setStep('done')
  }

  const finish = () => {
    const id = savedOrderId
    onClose()
    if (id && onOpenLead) onOpenLead(id)
  }

  // ── Screens ───────────────────────────────────────────────────────────────
  return (
    <div className="fi-shell">
      <style>{CSS}</style>

      {/* Discreet staff exit — top right, always present except on done */}
      {step !== 'done' && (
        <button type="button" className="fi-staff" onClick={() => setGate('exit')}>STAFF</button>
      )}

      {gate === 'exit' && (
        <StaffGate who={who} label="Exit intake"
          onPass={() => onClose()} onCancel={() => setGate(null)} />
      )}
      {gate === 'finish' && (
        <StaffGate who={who} label="Finish and open the lead"
          onPass={finish} onCancel={() => setGate(null)} />
      )}

      {step === 'welcome' && (
        <div className="fi-step fi-center">
          <div className="fi-brand">SHEVCHENKO <em>MONUMENTS</em></div>
          <div className="fi-hero">Welcome.</div>
          <div className="fi-hero-sub">
            We&#8217;ll take a few details so our staff can help you — your name,
            the cemetery, and who the memorial will honor. It takes about two minutes.
          </div>
          <button type="button" className="fi-big-btn" onClick={() => setStep('you')}>Begin</button>
        </div>
      )}

      {stepIdx >= 0 && (
        <div className="fi-step">
          <div className="fi-progress">
            {STEPS.map((s, i) => (
              <span key={s} className={`fi-dot${i <= stepIdx ? ' on' : ''}`} />
            ))}
          </div>

          {step === 'you' && (
            <>
              <div className="fi-h">About you</div>
              <div className="fi-grid2">
                <label className="fi-field">
                  <span className="fi-label">First name</span>
                  <input className="fi-input" value={first} autoFocus
                    autoComplete="given-name" onChange={e => setFirst(e.target.value)} />
                </label>
                <label className="fi-field">
                  <span className="fi-label">Last name</span>
                  <input className="fi-input" value={last}
                    autoComplete="family-name" onChange={e => setLast(e.target.value)} />
                </label>
              </div>
              <label className="fi-field">
                <span className="fi-label">Phone</span>
                <input className="fi-input" type="tel" inputMode="tel" value={phone}
                  placeholder="(555) 123-4567" autoComplete="tel" onChange={e => setPhone(e.target.value)} />
              </label>
              <label className="fi-field">
                <span className="fi-label">Email <span className="fi-opt">optional</span></span>
                <input className="fi-input" type="email" inputMode="email" value={email}
                  autoComplete="email" onChange={e => setEmail(e.target.value)} />
              </label>
              {!showAddr ? (
                <button type="button" className="fi-add" onClick={() => setShowAddr(true)}>
                  + Add mailing address
                </button>
              ) : (
                <>
                  <label className="fi-field">
                    <span className="fi-label">Street address</span>
                    <input className="fi-input" value={addr1} autoComplete="address-line1"
                      onChange={e => setAddr1(e.target.value)} />
                  </label>
                  <div className="fi-grid3">
                    <label className="fi-field">
                      <span className="fi-label">City</span>
                      <input className="fi-input" value={city} autoComplete="address-level2"
                        onChange={e => setCity(e.target.value)} />
                    </label>
                    <label className="fi-field">
                      <span className="fi-label">State</span>
                      <input className="fi-input" value={state} maxLength={2}
                        onChange={e => setState(e.target.value.toUpperCase())} />
                    </label>
                    <label className="fi-field">
                      <span className="fi-label">ZIP</span>
                      <input className="fi-input" inputMode="numeric" value={zip} maxLength={10}
                        autoComplete="postal-code" onChange={e => setZip(e.target.value)} />
                    </label>
                  </div>
                </>
              )}
              <div className="fi-nav">
                <button type="button" className="fi-back" onClick={() => setStep('welcome')}>Back</button>
                <button type="button" className="fi-big-btn" disabled={!canContinueYou}
                  style={{ opacity: canContinueYou ? 1 : 0.45 }}
                  onClick={() => setStep('cemetery')}>Continue</button>
              </div>
              {!canContinueYou && (first || last || phone) && (
                <div className="fi-hint">We need your first name, last name, and a phone number.</div>
              )}
            </>
          )}

          {step === 'cemetery' && (
            <>
              <div className="fi-h">Which cemetery?</div>
              <div className="fi-sub">Start typing and pick from the list — or type the name if it&#8217;s not there.</div>
              <div className="fi-field" style={{ position: 'relative' }}>
                <input className="fi-input" value={cemetery} placeholder="Cemetery name"
                  autoFocus onChange={e => onCemType(e.target.value)} />
                {cemResults.length > 0 && (
                  <div className="fi-menu">
                    {cemResults.slice(0, 6).map(r => (
                      <button type="button" key={r.id} className="fi-menu-item" onClick={() => pickCem(r)}>
                        <strong>{r.name}</strong>
                        {r.city ? <span className="fi-menu-meta"> · {r.city}{r.state ? `, ${r.state}` : ''}</span> : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {cemetery.trim() && !cemeteryId && cemResults.length === 0 && (
                <div className="fi-hint">That&#8217;s fine — we&#8217;ll add it.</div>
              )}
              <div className="fi-nav">
                <button type="button" className="fi-back" onClick={() => setStep('you')}>Back</button>
                <button type="button" className="fi-big-btn" onClick={() => setStep('service')}>
                  {cemetery.trim() ? 'Continue' : 'Not sure yet'}
                </button>
              </div>
            </>
          )}

          {step === 'service' && (
            <>
              <div className="fi-h">What can we help with?</div>
              {SERVICES.map(s => (
                <button key={s.code || 'unsure'} type="button"
                  className={`fi-card${service === s.code ? ' on' : ''}`}
                  onClick={() => setService(s.code)}>
                  <span className="fi-card-name">{s.label}</span>
                  <span className="fi-card-sub">{s.sub}</span>
                </button>
              ))}
              <div className="fi-nav">
                <button type="button" className="fi-back" onClick={() => setStep('cemetery')}>Back</button>
                <button type="button" className="fi-big-btn" disabled={service === null}
                  style={{ opacity: service === null ? 0.45 : 1 }}
                  onClick={() => setStep('people')}>Continue</button>
              </div>
            </>
          )}

          {step === 'people' && (
            <>
              <div className="fi-h">Who will this memorial honor?</div>
              <div className="fi-sub">Whatever you know is enough — our staff will help with the rest.</div>
              {people.map((p, i) => (
                <div key={i} className="fi-person">
                  {people.length > 1 && (
                    <div className="fi-person-head">
                      <span>Person {i + 1}</span>
                      <button type="button" className="fi-remove"
                        onClick={() => setPeople(list => list.filter((_, idx) => idx !== i))}>Remove</button>
                    </div>
                  )}
                  <div className="fi-grid2">
                    <label className="fi-field">
                      <span className="fi-label">First name</span>
                      <input className="fi-input" value={p.firstName}
                        onChange={e => setPerson(i, { firstName: e.target.value })} />
                    </label>
                    <label className="fi-field">
                      <span className="fi-label">Last name</span>
                      <input className="fi-input" value={p.lastName} placeholder={last.trim() || ''}
                        onChange={e => setPerson(i, { lastName: e.target.value })} />
                    </label>
                  </div>
                  <label className="fi-check">
                    <input type="checkbox" checked={p.isPreNeed}
                      onChange={e => setPerson(i, { isPreNeed: e.target.checked })} />
                    This is for the future (pre-need)
                  </label>
                  <div className="fi-grid2">
                    <label className="fi-field">
                      <span className="fi-label">Date of birth <span className="fi-opt">optional</span></span>
                      <input className="fi-input" type="date" value={p.dateOfBirth}
                        onChange={e => setPerson(i, { dateOfBirth: e.target.value })} />
                    </label>
                    {!p.isPreNeed && (
                      <label className="fi-field">
                        <span className="fi-label">Date of passing <span className="fi-opt">optional</span></span>
                        <input className="fi-input" type="date" value={p.dateOfDeath}
                          onChange={e => setPerson(i, { dateOfDeath: e.target.value })} />
                      </label>
                    )}
                  </div>
                  <label className="fi-field">
                    <span className="fi-label">Their relationship to you <span className="fi-opt">optional</span></span>
                    <input className="fi-input" value={p.relationship} placeholder="Mother, husband, grandfather…"
                      onChange={e => setPerson(i, { relationship: e.target.value })} />
                  </label>
                </div>
              ))}
              {people.length < 3 && (
                <button type="button" className="fi-add"
                  onClick={() => setPeople(list => [...list, blankPerson()])}>
                  + Add another person
                </button>
              )}
              <div className="fi-nav">
                <button type="button" className="fi-back" onClick={() => setStep('service')}>Back</button>
                <button type="button" className="fi-big-btn" onClick={() => setStep('review')}>Continue</button>
              </div>
            </>
          )}

          {step === 'review' && (
            <>
              <div className="fi-h">Does this look right?</div>
              <div className="fi-review">
                <div className="fi-rev-row"><span>Name</span><b>{first} {last}</b></div>
                <div className="fi-rev-row"><span>Phone</span><b>{phone || '—'}</b></div>
                {email.trim() && <div className="fi-rev-row"><span>Email</span><b>{email}</b></div>}
                <div className="fi-rev-row"><span>Cemetery</span><b>{cemetery.trim() || 'Not sure yet'}</b></div>
                <div className="fi-rev-row"><span>Service</span>
                  <b>{(SERVICES.find(s => s.code === service) || {}).label || 'Not sure yet'}</b></div>
                {namedPeople.map((p, i) => (
                  <div className="fi-rev-row" key={i}><span>For</span>
                    <b>{[p.firstName, p.lastName || last].filter(Boolean).join(' ')}{p.isPreNeed ? ' (future need)' : ''}</b>
                  </div>
                ))}
              </div>
              <label className="fi-field">
                <span className="fi-label">Anything else we should know? <span className="fi-opt">optional</span></span>
                <textarea className="fi-input fi-textarea" rows={3} value={extra}
                  onChange={e => setExtra(e.target.value)} />
              </label>
              {err && <div className="fi-err">{err}</div>}
              <div className="fi-nav">
                <button type="button" className="fi-back" onClick={() => setStep('people')} disabled={busy}>Back</button>
                <button type="button" className="fi-big-btn" onClick={submit} disabled={busy}>
                  {busy ? 'Saving…' : 'Submit'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 'done' && (
        <div className="fi-step fi-center">
          <div className="fi-hero">Thank you, {first.trim() || 'friend'}.</div>
          <div className="fi-hero-sub">
            We have your details. Please hand the {navigator.maxTouchPoints > 1 ? 'device' : 'phone'} back
            to our staff — they&#8217;ll take it from here.
          </div>
          <button type="button" className="fi-staff-finish" onClick={() => setGate('finish')}>
            Staff: finish
          </button>
        </div>
      )}
    </div>
  )
}

const CSS = `
.fi-shell { position: fixed; inset: 0; z-index: 90; background: #F5F3EE; overflow-y: auto; -webkit-overflow-scrolling: touch; font-family: Inter, -apple-system, sans-serif; }
.fi-step { max-width: 560px; margin: 0 auto; padding: 26px 20px calc(40px + env(safe-area-inset-bottom)); }
.fi-center { display: flex; flex-direction: column; justify-content: center; min-height: 92dvh; text-align: center; }
.fi-brand { font-size: 13px; font-weight: 800; letter-spacing: 0.14em; color: #6B6456; }
.fi-brand em { font-style: normal; color: #9A7209; }
.fi-hero { font-family: Fraunces, Georgia, serif; font-size: 40px; font-weight: 600; color: #16150F; margin-top: 18px; line-height: 1.1; }
.fi-hero-sub { font-size: 16.5px; color: #55503F; line-height: 1.6; margin: 16px auto 26px; max-width: 420px; }
.fi-h { font-family: Fraunces, Georgia, serif; font-size: 28px; font-weight: 600; color: #16150F; margin: 18px 0 6px; }
.fi-sub { font-size: 14.5px; color: #6B6456; line-height: 1.5; margin-bottom: 14px; }
.fi-progress { display: flex; gap: 7px; justify-content: center; }
.fi-dot { width: 8px; height: 8px; border-radius: 50%; background: #DAD3C2; }
.fi-dot.on { background: #9A7209; }
.fi-field { display: flex; flex-direction: column; gap: 6px; margin-top: 13px; }
.fi-label { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #8A7F6C; }
.fi-opt { font-weight: 600; text-transform: none; letter-spacing: 0; color: #A99F8A; }
.fi-input { font: inherit; font-size: 17px; padding: 15px 14px; border: 1.5px solid #DAD3C2; border-radius: 13px; background: #fff; color: #16150F; width: 100%; box-sizing: border-box; min-height: 56px; }
.fi-input:focus { outline: none; border-color: #9A7209; box-shadow: 0 0 0 3px rgba(154,114,9,0.13); }
.fi-textarea { min-height: 90px; resize: vertical; line-height: 1.5; }
.fi-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; }
.fi-grid3 { display: grid; grid-template-columns: 2fr 70px 1fr; gap: 11px; }
.fi-menu { position: absolute; top: 100%; left: 0; right: 0; z-index: 10; margin-top: 5px; background: #fff; border: 1px solid #E2DCCE; border-radius: 13px; box-shadow: 0 16px 40px rgba(22,21,15,0.14); overflow: hidden; }
.fi-menu-item { display: block; width: 100%; text-align: left; background: none; border: none; border-bottom: 1px solid #F0ECE2; font: inherit; font-size: 15.5px; padding: 14px; min-height: 52px; color: #16150F; cursor: pointer; }
.fi-menu-item:last-child { border-bottom: none; }
.fi-menu-meta { color: #8A7F6C; font-size: 13.5px; }
.fi-card { display: flex; flex-direction: column; gap: 3px; width: 100%; text-align: left; background: #fff; border: 1.5px solid #E2DCCE; border-radius: 14px; padding: 15px 16px; margin-top: 10px; min-height: 62px; cursor: pointer; font-family: inherit; }
.fi-card.on { border-color: #9A7209; box-shadow: 0 0 0 2px rgba(154,114,9,0.18); background: #FDFBF5; }
.fi-card-name { font-size: 16.5px; font-weight: 800; color: #16150F; }
.fi-card-sub { font-size: 13px; color: #8A7F6C; }
.fi-check { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 600; color: #55503F; margin-top: 13px; min-height: 44px; cursor: pointer; }
.fi-check input { width: 22px; height: 22px; accent-color: #9A7209; }
.fi-person { background: #FBFAF6; border: 1px solid #E8E2D2; border-radius: 16px; padding: 4px 15px 15px; margin-top: 13px; }
.fi-person-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #8A7F6C; margin-top: 12px; }
.fi-remove { background: none; border: none; font: inherit; font-size: 13px; font-weight: 700; color: #B3261E; cursor: pointer; padding: 6px; }
.fi-add { display: block; width: 100%; margin-top: 14px; background: none; border: 1.5px dashed #C9BFA8; border-radius: 13px; padding: 14px; font: inherit; font-size: 15px; font-weight: 700; color: #6B6456; min-height: 52px; cursor: pointer; }
.fi-nav { display: flex; gap: 10px; margin-top: 22px; align-items: center; }
.fi-back { background: none; border: none; font: inherit; font-size: 15.5px; font-weight: 700; color: #6B6456; padding: 14px 10px; min-height: 56px; cursor: pointer; }
.fi-big-btn { flex: 1; background: #0F1419; color: #F2EDE2; border: none; border-radius: 14px; font-family: inherit; font-size: 17px; font-weight: 800; min-height: 58px; cursor: pointer; }
.fi-big-btn:active { background: #1C2733; }
.fi-hint { font-size: 13px; color: #9A7209; font-weight: 600; margin-top: 10px; }
.fi-err { background: #FBEAEA; border: 1px solid #E7B3AD; color: #B3261E; border-radius: 11px; padding: 11px 13px; font-size: 14px; margin-top: 14px; }
.fi-review { background: #fff; border: 1px solid #E2DCCE; border-radius: 16px; padding: 6px 16px; margin-top: 8px; }
.fi-rev-row { display: flex; justify-content: space-between; gap: 14px; padding: 11px 0; border-bottom: 1px solid #F0ECE2; font-size: 15px; }
.fi-rev-row:last-child { border-bottom: none; }
.fi-rev-row span { color: #8A7F6C; flex-shrink: 0; }
.fi-rev-row b { color: #16150F; text-align: right; font-weight: 700; }
.fi-staff { position: fixed; top: calc(10px + env(safe-area-inset-top)); right: 12px; z-index: 95; background: none; border: 1px solid #DAD3C2; border-radius: 999px; font: inherit; font-size: 10.5px; font-weight: 800; letter-spacing: 0.08em; color: #A99F8A; padding: 7px 12px; cursor: pointer; }
.fi-staff-finish { margin-top: 30px; background: none; border: 1.5px solid #DAD3C2; border-radius: 13px; font: inherit; font-size: 14px; font-weight: 700; color: #6B6456; padding: 14px 22px; min-height: 52px; cursor: pointer; align-self: center; }
.fi-gate { position: fixed; inset: 0; z-index: 99; background: rgba(15,20,25,0.45); display: flex; align-items: center; justify-content: center; padding: 24px; }
.fi-gate-box { background: #fff; border-radius: 18px; padding: 22px; width: 100%; max-width: 360px; }
.fi-gate-title { font-family: Fraunces, Georgia, serif; font-size: 21px; font-weight: 600; color: #16150F; }
.fi-gate-sub { font-size: 13.5px; color: #6B6456; margin: 6px 0 14px; }
.fi-gate-row { display: flex; gap: 9px; margin-top: 16px; }
.fi-gate-row .fl-btn { flex: 1; margin-bottom: 0; }
`
