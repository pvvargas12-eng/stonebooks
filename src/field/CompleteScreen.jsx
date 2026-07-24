// =============================================================================
// CompleteScreen — camera-first job finish
// =============================================================================
// Photos go through the SAME completion-photo path the desktop Install Board
// uses (orders-attachments-public/<orderId>/completion/), so they show on the
// order instantly and unlock the closeout email. Mark installed is gated on
// at least one photo — no photo, no done.
// =============================================================================
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getJob, listCompletionPhotos, uploadCompletionPhoto,
  updateMilestone, updateMilestoneWithOverride, customerName,
  ensureCloseoutTask, deleteShopTask, removeFromInstallList, addToInstallList,
} from '../lib/stonebooksData'

const INSTALL_KEYS = ['installed', 'door_installed', 'work_completed']

export default function CompleteScreen({ jobId, orderId, onBack }) {
  const [job, setJob] = useState(undefined)
  const [photos, setPhotos] = useState(null)
  const [busy, setBusy] = useState(false)
  const [uploadErr, setUploadErr] = useState(null)
  const [doneState, setDoneState] = useState(null)   // { prevStatus, key } after marking
  const fileRef = useRef(null)

  const refreshPhotos = useCallback(() => {
    if (!orderId) return
    listCompletionPhotos(orderId).then(setPhotos).catch(() => setPhotos([]))
  }, [orderId])

  useEffect(() => {
    let cancelled = false
    if (jobId) getJob(jobId).then(j => { if (!cancelled) setJob(j) }).catch(() => setJob(null))
    else setJob(null)
    refreshPhotos()
    return () => { cancelled = true }
  }, [jobId, refreshPhotos])

  const installMs = (job?.milestones || []).find(m => INSTALL_KEYS.includes(m.milestone_key)) || null
  const alreadyDone = installMs?.status === 'done'
  const fam = (job?.order?.primary_lastname || customerName(job?.customer) || '').toUpperCase()

  const onPick = async (e) => {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    if (!files.length) return
    setBusy(true); setUploadErr(null)
    for (const f of files) {
      const res = await uploadCompletionPhoto(orderId, f)
      if (!res.ok) { setUploadErr(res.error || 'Upload failed.'); break }
    }
    setBusy(false)
    refreshPhotos()
  }

  const markInstalled = async () => {
    if (!job || !installMs) return
    setBusy(true)
    const prevStatus = installMs.status
    let res = await updateMilestone(job.id, installMs.milestone_key, { status: 'done' })
    if (!res.ok && res.requiresOverride) {
      res = await updateMilestoneWithOverride(job.id, installMs.milestone_key, { status: 'done' }, 'Completed in the field')
    }
    if (!res.ok) { setBusy(false); setUploadErr(res.error || 'Could not mark installed.'); return }
    // The closeout chain (Paul 2026-07-24): one Admin task carries the completion
    // email + call + closeout, and the job leaves the hand-picked set list.
    // Best-effort — a hiccup here never blocks the crew in the field.
    let closeoutTaskId = null
    try {
      const fam = job?.order?.primary_lastname || customerName(job?.customer) || ''
      const t = await ensureCloseoutTask(orderId, fam, job?.order?.order_number)
      closeoutTaskId = (!t?.skipped && t?.task?.id) || null
      await removeFromInstallList(job.id).catch(() => {})
      window.dispatchEvent(new CustomEvent('sb-field-install-done'))
    } catch { /* never block the field */ }
    setBusy(false)
    setDoneState({ prevStatus, key: installMs.milestone_key, closeoutTaskId })
  }

  const undoDone = async () => {
    if (!job || !doneState) return
    setBusy(true)
    await updateMilestone(job.id, doneState.key, { status: doneState.prevStatus || 'not_started' })
    // Reverse the chain: pull the auto-task we just created (only ours — a
    // pre-existing closeout task is left alone) and put the job back on the list.
    try {
      if (doneState.closeoutTaskId) await deleteShopTask(doneState.closeoutTaskId).catch(() => {})
      await addToInstallList(job.id).catch(() => {})
      window.dispatchEvent(new CustomEvent('sb-field-install-done'))
    } catch { /* best-effort */ }
    setBusy(false)
    setDoneState(null)
    setJob(await getJob(job.id).catch(() => job))
  }

  return (
    <div>
      <button type="button" className="fl-back" onClick={onBack}>&#8249; Back{fam ? ` to ${fam}` : ''}</button>
      <div className="fl-detfam" style={{ fontSize: 19 }}>Finish the job</div>
      <div className="fl-detsub">A final photo is required — it goes on the order record and into the family's closeout email.</div>

      <div className="fl-card">
        <div className="fl-eyebrow">Final photos</div>
        {photos === null && <div className="fl-photo-empty">Loading photos…</div>}
        {photos && photos.length === 0 && (
          <div className="fl-photo-empty">No photos yet — the camera opens straight from here.</div>
        )}
        {photos && photos.length > 0 && (
          <div className="fl-photo-strip">
            {photos.map(p => (
              <a key={p.path} href={p.url} target="_blank" rel="noreferrer">
                <img className="fl-photo-thumb" src={p.url} alt={p.name} loading="lazy" />
              </a>
            ))}
          </div>
        )}
        {uploadErr && <div style={{ fontSize: 12, color: '#B3261E', marginBottom: 8 }}>{uploadErr}</div>}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple
          style={{ display: 'none' }} onChange={onPick} />
        <button type="button" className="fl-btn" style={{ marginBottom: 0 }} disabled={busy}
          onClick={() => fileRef.current?.click()}>
          {busy ? 'Working…' : 'Open camera'}
        </button>
      </div>

      {job === undefined && <div className="fl-empty">Loading job…</div>}
      {job === null && <div className="fl-empty">No production job on this order — photos still saved to the order record.</div>}
      {job && !installMs && <div className="fl-empty">This job has no install step; photos are saved to the order record.</div>}

      {job && installMs && (
        doneState || alreadyDone ? (
          <>
            <button type="button" className="fl-btn fl-btn-green" disabled>
              Installed — photo saved to the order
            </button>
            {doneState && (
              <button type="button" className="fl-btn fl-btn-ghost" disabled={busy} onClick={undoDone}>
                Undo — I marked the wrong job
              </button>
            )}
          </>
        ) : (
          <button type="button" className="fl-btn fl-btn-green" disabled={busy || !photos || photos.length === 0}
            onClick={markInstalled}>
            {photos && photos.length > 0 ? 'Mark installed' : 'Add a photo to mark installed'}
          </button>
        )
      )}
    </div>
  )
}
