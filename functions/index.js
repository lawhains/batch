// Cloud Functions for Batch
//
// joinDeal      — Callable. Joins a user to a deal: creates commitment doc + increments
//                 currentBuyers atomically. Server-side because Stripe PaymentIntent creation
//                 (hold funds) will live here once payments are integrated.
//
// leaveDeal     — Callable. Removes a user from an open deal: deletes commitment doc +
//                 decrements currentBuyers atomically. Server-side because Stripe PaymentIntent
//                 cancellation will live here once payments are integrated.
//
// lockDeal      — Callable. Lets an organiser lock their deal early once minBuyers is met.
//                 Stripe payment capture for all commitments will live here.
//
// onDealUpdated — Firestore trigger that locks a deal when maxBuyers is hit (capacity full).
//                 minBuyers is a viability threshold checked at the deadline, not a lock trigger.
//
// expireDeals   — Scheduled function (hourly) that sweeps for past-deadline deals.
//                 Locks them if minBuyers was met, expires them if not.
//                 Stripe: capture payments on lock, cancel on expire.
//
// Locking logic summary:
//   currentBuyers hits maxBuyers           -> lock immediately (onDealUpdated)
//   organiser taps "Lock Deal"             -> lock early if minBuyers met (lockDeal)
//   deadline passes + currentBuyers >= min -> lock (expireDeals)
//   deadline passes + currentBuyers < min  -> expire (expireDeals)
//
// All functions use the Firebase Admin SDK, which bypasses Firestore security rules —
// that's intentional since these are trusted server operations, not client requests.

const { onDocumentUpdated } = require('firebase-functions/v2/firestore')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { setGlobalOptions } = require('firebase-functions')

initializeApp()
const db = getFirestore()

// Cap concurrent instances to keep costs predictable during development
setGlobalOptions({ maxInstances: 10 })

// ── onDealUpdated ─────────────────────────────────────────────────────────────
//
// Fires whenever any field on a deal document changes. The only early-lock case
// we care about is currentBuyers hitting maxBuyers (capacity full — no point waiting
// for the deadline if there's no room left).
//
// minBuyers is intentionally NOT a lock trigger here — if there's still time and
// room, the organiser and potential buyers benefit from more people joining.
// The deadline handles the minBuyers check in expireDeals.
//
// The early return on currentBuyers being unchanged prevents an infinite loop:
// our own status update would re-trigger this function, but the second invocation
// sees no buyer count change and exits immediately.
exports.onDealUpdated = onDocumentUpdated('deals/{dealId}', async (event) => {
  const before = event.data.before.data()
  const after  = event.data.after.data()

  // Ignore anything that didn't change currentBuyers (including our own status updates)
  if (before.currentBuyers === after.currentBuyers) return

  // Deal is already resolved — nothing to do
  if (after.status !== 'open') return

  // Lock immediately only if maxBuyers is set and the deal is now full.
  // If there's no cap, the deal stays open until the deadline.
  if (after.maxBuyers !== undefined && after.currentBuyers >= after.maxBuyers) {
    await event.data.after.ref.update({ status: 'locked' })
  }
})

// ── expireDeals ───────────────────────────────────────────────────────────────
//
// Runs every hour and sweeps for open deals whose deadline has passed.
// Two outcomes:
//   - enough buyers joined -> lock it (better late than never)
//   - not enough buyers   -> expire it (deal falls through)
//
// Uses batch writes so all status updates go in minimal Firestore round trips.
// Firestore batches cap at 500 operations, so we chunk to avoid failures at scale.
//
// Note: this query uses a composite index on (status ASC, deadline ASC)
// defined in firestore.indexes.json — Firestore will reject the query without it.
exports.expireDeals = onSchedule('every 1 hours', async () => {
  const now = new Date()

  const snapshot = await db
    .collection('deals')
    .where('status', '==', 'open')
    .where('deadline', '<=', now)
    .get()

  if (snapshot.empty) return

  // Firestore batch limit is 500 operations. Chunk the docs to stay under the
  // cap regardless of how many deals expire in a single sweep.
  const BATCH_LIMIT = 500
  for (let i = 0; i < snapshot.docs.length; i += BATCH_LIMIT) {
    const batch = db.batch()
    const chunk = snapshot.docs.slice(i, i + BATCH_LIMIT)

    chunk.forEach(doc => {
      const data = doc.data()
      // If enough buyers joined before the deadline, honour the deal
      const newStatus = data.currentBuyers >= data.minBuyers ? 'locked' : 'expired'
      batch.update(doc.ref, { status: newStatus })
    })

    await batch.commit()
  }
})

// ── lockDeal ──────────────────────────────────────────────────────────────────
//
// Callable HTTPS function — the organiser calls this to lock their deal early
// once minBuyers has been reached, without waiting for the deadline.
//
// Running this server-side matters for two reasons:
//   1. The Firestore rules prevent the organiser from writing status directly
//      from the client (status is function-owned)
//   2. When Stripe is integrated, locking will also trigger payment capture
//      for every commitment — that must happen server-side
//
// HttpsError codes map to standard gRPC status codes and are surfaced directly
// to the calling client, so the messages here are user-facing.
exports.lockDeal = onCall(async (request) => {
  // onCall automatically verifies the Firebase ID token — request.auth is null
  // if the caller isn't signed in
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to lock a deal.')
  }

  const { dealId } = request.data
  if (!dealId || typeof dealId !== 'string') {
    throw new HttpsError('invalid-argument', 'A valid dealId is required.')
  }

  const dealRef = db.collection('deals').doc(dealId)

  // Wrapped in a transaction to prevent TOCTOU (time-of-check-time-of-use) races.
  // Without this, the deal could change between our read and write — e.g. expireDeals
  // could expire the deal, or another join could change currentBuyers, between the
  // read and the update. The transaction ensures our validation and update are atomic.
  await db.runTransaction(async (t) => {
    const dealSnap = await t.get(dealRef)

    if (!dealSnap.exists) {
      throw new HttpsError('not-found', 'Deal not found.')
    }

    const deal = dealSnap.data()

    // Only the organiser can lock their own deal
    if (deal.organizerId !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Only the deal organiser can lock the deal.')
    }

    if (deal.status !== 'open') {
      throw new HttpsError('failed-precondition', `This deal is already ${deal.status}.`)
    }

    // Can only lock early once the minimum buyer threshold is met
    if (deal.currentBuyers < deal.minBuyers) {
      throw new HttpsError(
        'failed-precondition',
        `Need at least ${deal.minBuyers} buyers to lock. Currently at ${deal.currentBuyers}.`
      )
    }

    t.update(dealRef, { status: 'locked' })
  })

  // Return value is available to the client but not required
  return { success: true }
})

// ── joinDeal ────────────────────────────────────────────────────────────────
//
// Callable HTTPS function — adds a user to a deal by creating a commitment doc
// and incrementing currentBuyers inside a single transaction.
//
// This lives server-side (not as a client Firestore transaction) because:
//   1. Stripe PaymentIntent creation (authorize/hold funds) must happen server-side
//   2. Centralising the join logic here means the client is a simple function call,
//      and all validation + atomicity is in one place
//   3. Firestore rules can be tighter — the client never writes commitments or
//      touches currentBuyers directly
//
// The commitment doc ID follows the `${dealId}_${userId}` convention, which
// naturally prevents double-joining (the transaction checks for existence).
exports.joinDeal = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to join a deal.')
  }

  const { dealId } = request.data
  if (!dealId || typeof dealId !== 'string') {
    throw new HttpsError('invalid-argument', 'A valid dealId is required.')
  }

  const uid = request.auth.uid
  const dealRef = db.collection('deals').doc(dealId)
  // Predictable ID: prevents double-join without needing a query
  const commitmentRef = db.collection('commitments').doc(`${dealId}_${uid}`)

  await db.runTransaction(async (t) => {
    const dealSnap = await t.get(dealRef)
    const commitmentSnap = await t.get(commitmentRef)

    if (!dealSnap.exists) {
      throw new HttpsError('not-found', 'Deal not found.')
    }

    if (commitmentSnap.exists) {
      throw new HttpsError('already-exists', 'You have already joined this deal.')
    }

    const deal = dealSnap.data()

    if (deal.status !== 'open') {
      throw new HttpsError('failed-precondition', 'This deal is no longer open.')
    }

    // Server-side deadline guard: closes the ~59-min window between the deadline
    // passing and the expireDeals sweep running. The client also checks this,
    // but a determined user could bypass the client.
    if (deal.deadline.toDate() <= new Date()) {
      throw new HttpsError('failed-precondition', 'This deal\'s deadline has passed.')
    }

    // Capacity check — only applies when maxBuyers is set
    if (deal.maxBuyers !== undefined && deal.maxBuyers !== null
        && deal.currentBuyers >= deal.maxBuyers) {
      throw new HttpsError('failed-precondition', 'This deal has reached its maximum buyers.')
    }

    // Create the commitment doc.
    // When Stripe is integrated, the PaymentIntent will be created before this
    // and its ID stored here as paymentIntentId.
    t.set(commitmentRef, {
      dealId,
      userId: uid,
      joinedAt: Timestamp.now(),
      status: 'pending',
    })

    t.update(dealRef, { currentBuyers: deal.currentBuyers + 1 })
  })

  return { success: true }
})

// ── leaveDeal ───────────────────────────────────────────────────────────────
//
// Callable HTTPS function — removes a user from an open deal by deleting their
// commitment doc and decrementing currentBuyers inside a single transaction.
//
// Server-side for the same reasons as joinDeal:
//   1. Stripe PaymentIntent cancellation must happen server-side
//   2. Single source of truth for leave validation and atomicity
//   3. Client never touches currentBuyers or commitment docs directly
//
// Once the deal is locked or expired, leaving is blocked — the user's commitment
// (and eventual payment) is final.
exports.leaveDeal = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to leave a deal.')
  }

  const { dealId } = request.data
  if (!dealId || typeof dealId !== 'string') {
    throw new HttpsError('invalid-argument', 'A valid dealId is required.')
  }

  const uid = request.auth.uid
  const dealRef = db.collection('deals').doc(dealId)
  const commitmentRef = db.collection('commitments').doc(`${dealId}_${uid}`)

  await db.runTransaction(async (t) => {
    const dealSnap = await t.get(dealRef)
    const commitmentSnap = await t.get(commitmentRef)

    if (!dealSnap.exists) {
      throw new HttpsError('not-found', 'Deal not found.')
    }

    if (!commitmentSnap.exists) {
      throw new HttpsError('not-found', 'You are not in this deal.')
    }

    // Verify the commitment belongs to the caller — defence in depth,
    // since the doc ID convention already ties it to the user
    const commitment = commitmentSnap.data()
    if (commitment.userId !== uid) {
      throw new HttpsError('permission-denied', 'You can only leave your own commitments.')
    }

    const deal = dealSnap.data()

    if (deal.status !== 'open') {
      throw new HttpsError('failed-precondition', 'This deal has already locked — you can\'t leave now.')
    }

    // Same server-side deadline guard as joinDeal
    if (deal.deadline.toDate() <= new Date()) {
      throw new HttpsError('failed-precondition', 'This deal\'s deadline has passed.')
    }

    // When Stripe is integrated, cancel the PaymentIntent here before deleting
    // the commitment: stripe.paymentIntents.cancel(commitment.paymentIntentId)

    t.delete(commitmentRef)
    t.update(dealRef, { currentBuyers: deal.currentBuyers - 1 })
  })

  return { success: true }
})
