// Deal detail screen — shows full info about a single deal and handles three actions:
//   Join  — Stripe Payment Sheet flow: createPaymentSheet → initPaymentSheet →
//            presentPaymentSheet → joinDeal (with paymentIntentId)
//   Leave — calls leaveDeal Cloud Function (cancels Stripe hold + removes commitment)
//   Lock  — calls lockDeal Cloud Function (organiser only, once minBuyers is met,
//            captures all held PaymentIntents)
//
// Join is a two-step process because the Payment Sheet needs the PaymentIntent client_secret
// BEFORE the user sees the card form, and we only create the commitment AFTER they confirm.
// This prevents orphaned commitments for users who abandon the Payment Sheet mid-flow.
//
// All three actions are Cloud Functions — Stripe calls must be server-side (secret key),
// and centralising the logic keeps Firestore rules simple (client never writes commitments).
//
// Two real-time listeners run in parallel:
//   1. The deal doc        — keeps buyer count, status, and deadline live
//   2. The commitment doc  — tells us instantly if the current user has joined
//      (doc ID is predictable: `${dealId}_${userId}`, so no query needed)

import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native'
import { doc, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { FirebaseError } from 'firebase/app'
import { useLocalSearchParams, router } from 'expo-router'
import { useStripe } from '@stripe/stripe-react-native'
import { auth, db, functions } from '@/services/firebase'
import type { Deal } from '@/types'
import { mapDeal } from '@/utils/mapDeal'

export default function DealDetailScreen() {

  const { id } = useLocalSearchParams<{ id: string }>()
  const uid = auth.currentUser!.uid

  // initPaymentSheet configures the Payment Sheet with the PI client_secret.
  // presentPaymentSheet shows the native Stripe card UI to the user.
  const { initPaymentSheet, presentPaymentSheet } = useStripe()

  const [deal, setDeal] = useState<Deal | null>(null)
  const [alreadyJoined, setAlreadyJoined] = useState(false)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [locking, setLocking] = useState(false)
  const [error, setError] = useState('')

  // ── Listener 1: deal doc ──────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return

    const unsubscribe = onSnapshot(
      doc(db, 'deals', id),
      (snap) => {
        if (!snap.exists()) {
          setError('Deal not found.')
          setLoading(false)
          return
        }
        setDeal(mapDeal(snap))
        setLoading(false)
      },
      () => {
        setError('Failed to load deal. Please go back and try again.')
        setLoading(false)
      }
    )

    return unsubscribe
  }, [id])

  // ── Listener 2: commitment doc ────────────────────────────────────────────
  useEffect(() => {
    if (!id) return

    const commitmentRef = doc(db, 'commitments', `${id}_${uid}`)
    const unsubscribe = onSnapshot(commitmentRef, (snap) => {
      setAlreadyJoined(snap.exists())
    })

    return unsubscribe
  }, [id, uid])

  // ── Join ──────────────────────────────────────────────────────────────────
  // Three-step Stripe Payment Sheet flow:
  //   1. createPaymentSheet — server creates Customer, ephemeral key, and
  //      PaymentIntent (capture_method: 'manual' = hold, not charge)
  //   2. initPaymentSheet + presentPaymentSheet — show the native Stripe card UI
  //   3. joinDeal — only called after the user confirms; creates the commitment
  //      doc with the verified paymentIntentId and increments currentBuyers
  //
  // If the user dismisses the Payment Sheet (presentError.code === 'Canceled'),
  // we silently exit — no error shown, no commitment created.
  const handleJoin = async () => {
    setJoining(true)
    setError('')

    try {
      // Step 1: Ask the server to set up the PaymentIntent and return the
      // client_secret we need to initialise the Payment Sheet.
      const createPaymentSheet = httpsCallable(functions, 'createPaymentSheet')
      const { data } = await createPaymentSheet({ dealId: id }) as {
        data: { paymentIntent: string; paymentIntentId: string; ephemeralKey: string; customer: string }
      }

      // Step 2a: Configure the Payment Sheet with the server-provided params.
      const { error: initError } = await initPaymentSheet({
        paymentIntentClientSecret: data.paymentIntent,
        customerEphemeralKeySecret: data.ephemeralKey,
        customerId: data.customer,
        merchantDisplayName: 'Batch',
      })
      if (initError) {
        setError(initError.message)
        return
      }

      // Step 2b: Show the native Stripe card input UI to the user.
      const { error: presentError } = await presentPaymentSheet()
      if (presentError) {
        // 'Canceled' means the user dismissed the sheet — not an error, just exit quietly.
        if (presentError.code !== 'Canceled') {
          setError(presentError.message)
        }
        return
      }

      // Step 3: Payment authorized (hold placed on card). Tell the server to create
      // the commitment. joinDeal verifies the PI metadata and status server-side
      // before writing anything — prevents cross-deal or cross-user attacks.
      const joinDeal = httpsCallable(functions, 'joinDeal')
      await joinDeal({ dealId: id, paymentIntentId: data.paymentIntentId })

      // The onSnapshot listener will pick up the new commitment and deal changes automatically.
    } catch (e) {
      if (e instanceof FirebaseError) {
        setError(e.message)
      } else {
        setError('Failed to join. Please try again.')
      }
    } finally {
      setJoining(false)
    }
  }

  // ── Leave ─────────────────────────────────────────────────────────────────
  // Calls the leaveDeal Cloud Function — cancels the Stripe PaymentIntent (releases
  // the hold on the user's card), deletes the commitment doc, and decrements
  // currentBuyers atomically, all server-side.
  const handleLeave = async () => {
    setLeaving(true)
    setError('')

    try {
      const leaveDeal = httpsCallable(functions, 'leaveDeal')
      await leaveDeal({ dealId: id })
    } catch (e) {
      if (e instanceof FirebaseError) {
        setError(e.message)
      } else {
        setError('Failed to leave. Please try again.')
      }
    } finally {
      setLeaving(false)
    }
  }

  // ── Lock Deal (organiser only) ────────────────────────────────────────────
  // Calls the lockDeal Cloud Function rather than writing Firestore directly —
  // the security rules block client-side status changes, and the function
  // captures all held PaymentIntents (charges every committed buyer) server-side.
  const handleLockDeal = async () => {
    setLocking(true)
    setError('')

    try {
      const lockDeal = httpsCallable(functions, 'lockDeal')
      await lockDeal({ dealId: id })
      // onSnapshot will pick up the status change automatically
    } catch (e) {
      // FirebaseError.message contains the human-readable string thrown by the function
      if (e instanceof FirebaseError) {
        setError(e.message)
      } else {
        setError('Failed to lock deal. Please try again.')
      }
    } finally {
      setLocking(false)
    }
  }

  // ── Loading / error states ────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#FF6B35" />
      </View>
    )
  }

  if (!deal) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error || 'Deal not found.'}</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Go back</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── Derived display values ────────────────────────────────────────────────
  const isOrganizer  = deal.organizerId === uid
  const isClosed     = deal.status !== 'open'
  const isFull       = deal.maxBuyers !== undefined && deal.currentBuyers >= deal.maxBuyers
  // expireDeals runs hourly, so there's up to a ~59-minute window where a deal's
  // deadline has passed but its status is still 'open'. This client-side check
  // closes that gap so the UI reflects the real state immediately.
  const isPastDeadline = deal.deadline < new Date()
  const canLockEarly = isOrganizer && !isClosed && !isPastDeadline && deal.currentBuyers >= deal.minBuyers
  const buyersNeeded = Math.max(0, deal.minBuyers - deal.currentBuyers)
  const progress     = Math.min(deal.currentBuyers / deal.minBuyers, 1)

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <ScrollView contentContainerStyle={styles.container}>

      {/* Title + status badge */}
      <View style={styles.titleRow}>
        <Text style={styles.title}>{deal.title}</Text>
        {isClosed && (
          <View style={styles.closedBadge}>
            <Text style={styles.closedBadgeText}>{deal.status}</Text>
          </View>
        )}
      </View>

      {/* Price */}
      <Text style={styles.price}>${deal.pricePerPerson.toFixed(2)} per person</Text>

      {/* Buyer progress */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Buyers</Text>
        <Text style={styles.sectionValue}>
          {deal.currentBuyers} joined · {deal.minBuyers} needed to lock
          {deal.maxBuyers !== undefined ? ` · max ${deal.maxBuyers}` : ''}
        </Text>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { flex: progress }]} />
          <View style={{ flex: Math.max(1 - progress, 0) }} />
        </View>

        {!isClosed && !isFull && buyersNeeded > 0 && (
          <Text style={styles.progressHint}>{buyersNeeded} more needed to lock this deal</Text>
        )}
        {isFull && <Text style={styles.progressHint}>Deal is full</Text>}
      </View>

      {/* Deadline */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Deadline</Text>
        <Text style={styles.sectionValue}>{deal.deadline.toLocaleDateString()}</Text>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {/* Organiser controls — only visible to the organiser while the deal is open */}
      {isOrganizer && !isClosed && (
        <View style={styles.organizerSection}>
          <Text style={styles.organizerLabel}>Organiser controls</Text>
          {canLockEarly ? (
            <TouchableOpacity
              style={[styles.lockButton, locking && styles.lockButtonDisabled]}
              onPress={handleLockDeal}
              disabled={locking}
            >
              {locking
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.lockButtonText}>Lock Deal Now</Text>
              }
            </TouchableOpacity>
          ) : (
            <Text style={styles.progressHint}>
              Lock Deal becomes available once {deal.minBuyers} buyers have joined
            </Text>
          )}
        </View>
      )}

      {/* Participant controls */}
      {alreadyJoined ? (
        <View>
          <View style={styles.joinedBanner}>
            <Text style={styles.joinedBannerText}>You're in!</Text>
          </View>
          {/* Can only leave while the deal is still open and before the deadline.
              Once the deadline passes, expireDeals will resolve the deal shortly. */}
          {!isClosed && !isPastDeadline && (
            <TouchableOpacity
              style={styles.leaveButton}
              onPress={handleLeave}
              disabled={leaving}
            >
              {leaving
                ? <ActivityIndicator color="#cc0000" size="small" />
                : <Text style={styles.leaveButtonText}>Leave deal</Text>
              }
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.joinButton, (isClosed || isFull || isPastDeadline || joining) && styles.joinButtonDisabled]}
          onPress={handleJoin}
          disabled={isClosed || isFull || isPastDeadline || joining}
        >
          {joining
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.joinButtonText}>
                {isClosed ? 'Deal closed' : isPastDeadline ? 'Deadline passed' : isFull ? 'Deal full' : 'Join Deal'}
              </Text>
          }
        </TouchableOpacity>
      )}

    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingTop: 12,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    flexShrink: 1,
  },
  closedBadge: {
    backgroundColor: '#eee',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  closedBadgeText: {
    fontSize: 12,
    color: '#888',
    textTransform: 'capitalize',
  },
  price: {
    fontSize: 18,
    color: '#FF6B35',
    fontWeight: '600',
    marginBottom: 24,
  },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#aaa',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  sectionValue: {
    fontSize: 15,
    color: '#333',
    marginBottom: 10,
  },
  progressTrack: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    backgroundColor: '#eee',
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: '#FF6B35',
    borderRadius: 3,
  },
  progressHint: {
    fontSize: 12,
    color: '#aaa',
    marginTop: 6,
  },
  errorText: {
    color: '#cc0000',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
  },
  organizerSection: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 16,
    marginTop: 8,
    marginBottom: 8,
  },
  organizerLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#aaa',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  lockButton: {
    backgroundColor: '#333',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  lockButtonDisabled: {
    backgroundColor: '#33333380',
  },
  lockButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  joinButton: {
    backgroundColor: '#FF6B35',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  joinButtonDisabled: {
    backgroundColor: '#FF6B3580',
  },
  joinButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  joinedBanner: {
    backgroundColor: '#e6f4ea',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  joinedBannerText: {
    color: '#2e7d32',
    fontWeight: '600',
    fontSize: 16,
  },
  leaveButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  leaveButtonText: {
    color: '#cc0000',
    fontSize: 14,
  },
  backButton: {
    marginTop: 16,
  },
  backButtonText: {
    color: '#FF6B35',
    fontSize: 14,
  },
})
