// =============================================================================
// blastLadder — the trade sandblasting status ladder, shared desk + phone
// =============================================================================
// ONE definition of the vendor blasting workflow: SandblastBoard (desktop
// Jobs › Sandblasting) and the field SandblastScreen step the same ladder via
// updateVendorItem, so Vendors, the trade portal, and both boards always agree.
export const BLAST_ACTIVE = ['submitted', 'waiting_on_info', 'ready_to_work', 'in_progress', 'design_uploaded', 'ready_for_pickup']
export const BLAST_NEXT = {
  submitted: 'ready_to_work', waiting_on_info: 'ready_to_work', ready_to_work: 'in_progress',
  in_progress: 'ready_for_pickup', design_uploaded: 'ready_for_pickup', ready_for_pickup: 'completed',
}
export const BLAST_PREV = {
  completed: 'ready_for_pickup', ready_for_pickup: 'in_progress', in_progress: 'ready_to_work',
  ready_to_work: 'submitted', design_uploaded: 'in_progress', waiting_on_info: 'submitted',
}
export const BLAST_TONE = {
  submitted: '#8b93a1', waiting_on_info: '#e05d55', ready_to_work: '#6fb3f0',
  in_progress: '#d8a03f', design_uploaded: '#a78bfa', ready_for_pickup: '#39c6a5',
  completed: '#4fbf7c', cancelled: '#767c86',
}
export const blastLabel = (s) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
