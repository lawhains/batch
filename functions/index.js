// Cloud Functions for Batch
//
// createPaymentSheet — Callable. Prepares Stripe Payment Sheet params for a user
//                      joining a deal: get-or-create Customer, ephemeral key, and
//                      PaymentIntent with capture_method: 'manual' (hold, not charge).
//
// joinDeal      — Callable. Joins a user to a deal after they confirm payment in the
//                 Payment Sheet. Verifies the PaymentIntent, creates commitment doc
//                 (status: 'held'), and increments currentBuyers atomically.
//
// leaveDeal     — Callable. Removes a user from an open deal: cancels the Stripe
//                 PaymentIntent (releases the hold), deletes commitment doc, and
//                 decrements currentBuyers atomically.
//
// lockDeal      — Callable. Lets an organiser lock their deal early once minBuyers is met.
//                 After locking, captures all held PaymentIntents (charges the cards).
//
// onDealUpdated — Firestore trigger that locks a deal when maxBuyers is hit (capacity full).
//                 After locking, captures all held PaymentIntents.
//
// expireDeals   — Scheduled function (hourly) that sweeps for past-deadline deals.
//                 Locks them if minBuyers was met (+ captures payments), expires them
//                 if not (+ cancels/releases all holds).
//
// Locking logic summary:
//   currentBuyers hits maxBuyers           -> lock immediately (onDealUpdated) + capture
//   organiser taps "Lock Deal"             -> lock early if minBuyers met (lockDeal) + capture
//   deadline passes + currentBuyers >= min -> lock (expireDeals) + capture
//   deadline passes + currentBuyers < min  -> expire (expireDeals) + cancel/release
//
// All functions use the Firebase Admin SDK, which bypasses Firestore security rules —
// that's intentional since these are trusted server operations, not client requests.

const { onDocumentUpdated } = require('firebase-functions/v2/firestore')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { setGlobalOptions } = require('firebase-functions')

initializeApp()
const db = getFirestore()

// Cap concurrent instances to keep costs predictable during development
setGlobalOptions({ maxInstances: 10 })

// Stripe secret key — injected at runtime via Firebase secrets.
// Set it with: firebase functions:secrets:set STRIPE_SECRET_KEY
// defineSecret is required because firebase.json has disallowLegacyRuntimeConfig: true,
// which blocks the old functions.config() approach.
const stripeSecret = defineSecret('STRIPE_SECRET_KEY')

// ── Stripe helpers ──────────────────────────────────────────────────────────
//
// Shared by lockDeal, onDealUpdated, and expireDeals to avoid code duplication.
// Both accept the stripe instance as a parameter because the SDK is initialised
// inside each function (the secret value isn't available at module scope).

/**
 * Capture all held PaymentIntents for a deal (used when a deal locks).
 * Uses Promise.allSettled so one failed capture (e.g. expired card) doesn't
 * block the others — failed ones stay 'held' and can be retried manually.
 */
async function captureAllForDeal(stripe, dealId) {
  const commitments = await db.collection('commitments')
    .where('dealId', '==', dealId)
    .where('status', '==', 'held')
    .get()

  if (commitments.empty) return

  const results = await Promise.allSettled(
    commitments.docs.map(async (commitDoc) => {
      const { paymentIntentId } = commitDoc.data()
      await stripe.paymentIntents.capture(paymentIntentId)
      await commitDoc.ref.update({ status: 'charged' })
    })
  )

  // Log failures so they're visible in Cloud Functions logs for manual retry
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(
        `Failed to capture PI for commitment ${commitments.docs[i].id}:`,
        result.reason
      )
    }
  })
}

/**
 * Cancel all held PaymentIntents for a deal (used when a deal expires).
 * Releases the hold on each user's card. Same allSettled pattern as capture.
 */
async function cancelAllForDeal(stripe, dealId) {
  const commitments = await db.collection('commitments')
    .where('dealId', '==', dealId)
    .where('status', '==', 'held')
    .get()

  if (commitments.empty) return

  const results = await Promise.allSettled(
    commitments.docs.map(async (commitDoc) => {
      const { paymentIntentId } = commitDoc.data()
      await stripe.paymentIntents.cancel(paymentIntentId)
      await commitDoc.ref.update({ status: 'released' })
    })
  )

  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(
        `Failed to cancel PI for commitment ${commitments.docs[i].id}:`,
        result.reason
      )
    }
  })
}

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
//
// After locking, all held PaymentIntents are captured (cards charged).
exports.onDealUpdated = onDocumentUpdated(
  { document: 'deals/{dealId}', secrets: [stripeSecret] },
  async (event) => {
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

      // Capture all held payments now that the deal is locked
      const stripe = require('stripe')(stripeSecret.value())
      await captureAllForDeal(stripe, event.params.dealId)
    }
  }
)

// ── expireDeals ───────────────────────────────────────────────────────────────
//
// Runs every hour and sweeps for open deals whose deadline has passed.
// Two outcomes:
//   - enough buyers joined -> lock it + capture all payments
//   - not enough buyers   -> expire it + cancel/release all holds
//
// Uses batch writes so all status updates go in minimal Firestore round trips.
// Firestore batches cap at 500 operations, so we chunk to avoid failures at scale.
//
// Note: this query uses a composite index on (status ASC, deadline ASC)
// defined in firestore.indexes.json — Firestore will reject the query without it.
exports.expireDeals = onSchedule(
  { schedule: 'every 1 hours', secrets: [stripeSecret] },
  async () => {
    const now = new Date()

    const snapshot = await db
      .collection('deals')
      .where('status', '==', 'open')
      .where('deadline', '<=', now)
      .get()

    if (snapshot.empty) return

    const stripe = require('stripe')(stripeSecret.value())

    // Firestore batch limit is 500 operations. Chunk the docs to stay under the
    // cap regardless of how many deals expire in a single sweep.
    const BATCH_LIMIT = 500
    for (let i = 0; i < snapshot.docs.length; i += BATCH_LIMIT) {
      const batch = db.batch()
      const chunk = snapshot.docs.slice(i, i + BATCH_LIMIT)

      // Track which deals got locked vs expired so we can process payments after
      const lockedDealIds = []
      const expiredDealIds = []

      chunk.forEach(doc => {
        const data = doc.data()
        // If enough buyers joined before the deadline, honour the deal
        const newStatus = data.currentBuyers >= data.minBuyers ? 'locked' : 'expired'
        batch.update(doc.ref, { status: newStatus })

        if (newStatus === 'locked') {
          lockedDealIds.push(doc.id)
        } else {
          expiredDealIds.push(doc.id)
        }
      })

      await batch.commit()

      // Process Stripe payments after the batch commit:
      // - Locked deals: capture all held PIs (charge the cards)
      // - Expired deals: cancel all held PIs (release the holds)
      await Promise.allSettled([
        ...lockedDealIds.map(dealId => captureAllForDeal(stripe, dealId)),
        ...expiredDealIds.map(dealId => cancelAllForDeal(stripe, dealId)),
      ])
    }
  }
)

// ── lockDeal ──────────────────────────────────────────────────────────────────
//
// Callable HTTPS function — the organiser calls this to lock their deal early
// once minBuyers has been reached, without waiting for the deadline.
//
// Running this server-side matters for two reasons:
//   1. The Firestore rules prevent the organiser from writing status directly
//      from the client (status is function-owned)
//   2. Locking captures all held PaymentIntents (charges every committed buyer)
//
// HttpsError codes map to standard gRPC status codes and are surfaced directly
// to the calling client, so the messages here are user-facing.
exports.lockDeal = onCall({ secrets: [stripeSecret] }, async (request) => {
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

  // Capture all held PaymentIntents now that the deal is locked.
  // This runs outside the transaction because Stripe calls are idempotent
  // and don't need Firestore atomicity — each capture is independent.
  const stripe = require('stripe')(stripeSecret.value())
  await captureAllForDeal(stripe, dealId)

  return { success: true }
})

// ── createPaymentSheet ────────────────────────────────────────────────────────
//
// Callable HTTPS function — called by the client before showing the Stripe
// Payment Sheet. Prepares everything Stripe needs:
//   1. Get-or-create a Stripe Customer for this Firebase user
//   2. Create an ephemeral key (lets the Payment Sheet access the customer)
//   3. Create a PaymentIntent with capture_method: 'manual' (hold, don't charge)
//
// This is a separate step from joinDeal because the Payment Sheet needs the
// client_secret BEFORE the user confirms payment. The flow is:
//   createPaymentSheet -> user sees Payment Sheet -> user confirms -> joinDeal
// This prevents creating commitments for users who abandon the Payment Sheet.
exports.createPaymentSheet = onCall({ secrets: [stripeSecret] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.')
  }

  const { dealId } = request.data
  if (!dealId || typeof dealId !== 'string') {
    throw new HttpsError('invalid-argument', 'A valid dealId is required.')
  }

  const uid = request.auth.uid
  const stripe = require('stripe')(stripeSecret.value())

  // ── Validate the deal is joinable ──────────────────────────────────────
  const dealSnap = await db.collection('deals').doc(dealId).get()
  if (!dealSnap.exists) {
    throw new HttpsError('not-found', 'Deal not found.')
  }

  const deal = dealSnap.data()
  if (deal.status !== 'open') {
    throw new HttpsError('failed-precondition', 'This deal is no longer open.')
  }
  if (deal.deadline.toDate() <= new Date()) {
    throw new HttpsError('failed-precondition', "This deal's deadline has passed.")
  }
  if (deal.maxBuyers !== undefined && deal.maxBuyers !== null
      && deal.currentBuyers >= deal.maxBuyers) {
    throw new HttpsError('failed-precondition', 'This deal has reached its maximum buyers.')
  }

  // Check if already joined — no point showing Payment Sheet if they're already in
  const existingCommitment = await db.collection('commitments').doc(`${dealId}_${uid}`).get()
  if (existingCommitment.exists) {
    throw new HttpsError('already-exists', 'You have already joined this deal.')
  }

  // ── Get or create Stripe Customer ──────────────────────────────────────
  // Persisted on the user doc so returning users reuse the same Customer,
  // which lets Stripe remember their saved payment methods.
  const userRef = db.collection('users').doc(uid)
  const userSnap = await userRef.get()
  let stripeCustomerId = userSnap.exists ? userSnap.data().stripeCustomerId : null

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      metadata: { firebaseUid: uid },
    })
    stripeCustomerId = customer.id
    // Merge so we don't overwrite other user fields (e.g. displayName, email)
    await userRef.set({ stripeCustomerId }, { merge: true })
  }

  // ── Create ephemeral key ───────────────────────────────────────────────
  // Short-lived key that lets the Payment Sheet access this customer's data.
  // The apiVersion must match what the Stripe React Native SDK expects.
  const ephemeralKey = await stripe.ephemeralKeys.create(
    { customer: stripeCustomerId },
    { apiVersion: '2025-01-27.acacia' }
  )

  // ── Create PaymentIntent ───────────────────────────────────────────────
  // capture_method: 'manual' = authorize (hold) the funds but don't charge yet.
  // The capture happens later when the deal locks (lockDeal / expireDeals / onDealUpdated).
  // Metadata ties this PI to a specific deal and user so joinDeal can verify it.
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(deal.pricePerPerson * 100), // cents — round to avoid floating-point issues
    currency: 'usd',
    customer: stripeCustomerId,
    capture_method: 'manual',
    metadata: { dealId, userId: uid },
  })

  return {
    paymentIntent: paymentIntent.client_secret,   // for initPaymentSheet on the client
    paymentIntentId: paymentIntent.id,             // passed to joinDeal after user confirms
    ephemeralKey: ephemeralKey.secret,
    customer: stripeCustomerId,
  }
})

// ── joinDeal ────────────────────────────────────────────────────────────────
//
// Callable HTTPS function — adds a user to a deal after they confirm payment
// in the Stripe Payment Sheet. Creates a commitment doc (status: 'held') and
// increments currentBuyers inside a single transaction.
//
// The PaymentIntent was created by createPaymentSheet and authorized by the user
// through the Payment Sheet. This function verifies the PI is valid, belongs to
// this user and deal, and is in the 'requires_capture' state before committing.
//
// The commitment doc ID follows the `${dealId}_${userId}` convention, which
// naturally prevents double-joining (the transaction checks for existence).
exports.joinDeal = onCall({ secrets: [stripeSecret] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to join a deal.')
  }

  const { dealId, paymentIntentId } = request.data
  if (!dealId || typeof dealId !== 'string') {
    throw new HttpsError('invalid-argument', 'A valid dealId is required.')
  }
  if (!paymentIntentId || typeof paymentIntentId !== 'string') {
    throw new HttpsError('invalid-argument', 'A valid paymentIntentId is required.')
  }

  const uid = request.auth.uid
  const stripe = require('stripe')(stripeSecret.value())

  // ── Verify the PaymentIntent before entering the transaction ───────────
  //
  // This ensures the PI exists, belongs to this user/deal, and the hold succeeded.
  // Done outside the transaction because Stripe calls can't participate in
  // Firestore transactions, and this is a read-only verification.
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId)

  // Guard against cross-deal or cross-user attacks — a malicious client could
  // try to reuse a PI from a different deal or another user's session
  if (pi.metadata.dealId !== dealId || pi.metadata.userId !== uid) {
    throw new HttpsError('invalid-argument', 'PaymentIntent does not match this deal.')
  }

  // 'requires_capture' means the card was authorized (hold placed) but not yet charged.
  // Any other status means the PI wasn't properly authorized through the Payment Sheet.
  if (pi.status !== 'requires_capture') {
    throw new HttpsError('failed-precondition', 'Payment was not authorized.')
  }

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

    // Create the commitment doc with the verified PaymentIntent.
    // Status is 'held' because the PI is already authorized (hold placed on card).
    t.set(commitmentRef, {
      dealId,
      userId: uid,
      joinedAt: Timestamp.now(),
      status: 'held',
      paymentIntentId,
    })

    t.update(dealRef, { currentBuyers: deal.currentBuyers + 1 })
  })

  return { success: true }
})

// ── leaveDeal ───────────────────────────────────────────────────────────────
//
// Callable HTTPS function — removes a user from an open deal by cancelling their
// Stripe PaymentIntent (releases the hold), deleting their commitment doc, and
// decrementing currentBuyers inside a single transaction.
//
// Once the deal is locked or expired, leaving is blocked — the user's commitment
// (and payment) is final.
exports.leaveDeal = onCall({ secrets: [stripeSecret] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to leave a deal.')
  }

  const { dealId } = request.data
  if (!dealId || typeof dealId !== 'string') {
    throw new HttpsError('invalid-argument', 'A valid dealId is required.')
  }

  const uid = request.auth.uid
  const stripe = require('stripe')(stripeSecret.value())
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

    // Cancel the PaymentIntent to release the hold on the user's card.
    // Done inside the transaction logic (though the Stripe call itself is external)
    // to ensure we only cancel if all validation passes.
    if (commitment.paymentIntentId) {
      await stripe.paymentIntents.cancel(commitment.paymentIntentId)
    }

    t.delete(commitmentRef)
    t.update(dealRef, { currentBuyers: deal.currentBuyers - 1 })
  })

  return { success: true }
})
