// Deal detail screen — shows full info about a single deal and lets users join it.
//
// Two real-time listeners run in parallel:
//   1. The deal doc   — so buyer count, status, and deadline stay live
//   2. The user's own commitment doc — so the Join button reflects the current state
//      without needing an extra query (the doc ID is predictable: `${dealId}_${userId}`)
//
// Joining uses a Firestore transaction to atomically:
//   1. Confirm the deal is still open and not full
//   2. Confirm the user hasn't already joined
//   3. Write the commitment doc
//   4. Increment currentBuyers on the deal
//
// All of this could be bypassed by hitting the REST API directly, so the Firestore
// security rules enforce the same constraints server-side.

import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native'
import { doc, onSnapshot, runTransaction, Timestamp } from 'firebase/firestore'
import { useLocalSearchParams, router } from 'expo-router'
import { auth, db } from '@/services/firebase'
import type { Deal } from '@/types'

export default function DealDetailScreen() {

  // Expo Router puts dynamic segment values in useLocalSearchParams
  const { id } = useLocalSearchParams<{ id: string }>()

  // Safe to assert non-null — auth guard in _layout.tsx ensures a user is signed in
  const uid = auth.currentUser!.uid

  const [deal, setDeal] = useState<Deal | null>(null)
  const [alreadyJoined, setAlreadyJoined] = useState(false)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
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
        const data = snap.data()
        setDeal({
          ...data,
          id: snap.id,
          // Firestore Timestamps need converting — same pattern as the feed screen
          deadline: data.deadline?.toDate() ?? new Date(),
        } as Deal)
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

    // The commitment doc ID is `${dealId}_${userId}` — a predictable compound key.
    // This means we can listen to it directly rather than querying the collection,
    // and it also naturally prevents one user from joining the same deal twice.
    const commitmentRef = doc(db, 'commitments', `${id}_${uid}`)

    const unsubscribe = onSnapshot(commitmentRef, (snap) => {
      setAlreadyJoined(snap.exists())
    })

    return unsubscribe
  }, [id, uid])

  // ── Join handler ──────────────────────────────────────────────────────────
  const handleJoin = async () => {
    if (!deal) return
    setJoining(true)
    setError('')

    try {
      const dealRef = doc(db, 'deals', id)
      const commitmentRef = doc(db, 'commitments', `${id}_${uid}`)

      await runTransaction(db, async (transaction) => {
        // Read both docs inside the transaction so the checks and writes are atomic.
        // If another user joins between our read and write, Firestore retries automatically.
        const dealSnap = await transaction.get(dealRef)
        const commitmentSnap = await transaction.get(commitmentRef)

        if (!dealSnap.exists()) throw new Error('deal-not-found')
        if (commitmentSnap.exists()) throw new Error('already-joined')

        const data = dealSnap.data()
        if (data.status !== 'open') throw new Error('deal-closed')
        // maxBuyers is optional — only enforce the cap if the organiser set one
        if (data.maxBuyers !== undefined && data.currentBuyers >= data.maxBuyers) {
          throw new Error('deal-full')
        }

        // Write the commitment first, then update the deal count
        transaction.set(commitmentRef, {
          dealId: id,
          userId: uid,
          joinedAt: Timestamp.now(),
          status: 'pending', // no payment yet — Stripe integration comes later
        })

        transaction.update(dealRef, {
          currentBuyers: data.currentBuyers + 1,
        })
      })

      // No manual state update needed — the onSnapshot listeners above will fire
      // and update alreadyJoined + deal.currentBuyers automatically

    } catch (e) {
      // Map internal error codes to user-friendly messages
      if (e instanceof Error) {
        if (e.message === 'already-joined') setError('You have already joined this deal.')
        else if (e.message === 'deal-closed') setError('This deal is no longer open.')
        else if (e.message === 'deal-full') setError('This deal has reached its maximum buyers.')
        else setError('Failed to join. Please try again.')
      } else {
        setError('Failed to join. Please try again.')
      }
    } finally {
      setJoining(false)
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
  const isClosed = deal.status !== 'open'
  const isFull = deal.maxBuyers !== undefined && deal.currentBuyers >= deal.maxBuyers
  const buyersNeeded = Math.max(0, deal.minBuyers - deal.currentBuyers)
  // Progress as a fraction (capped at 1 so the bar never overflows)
  const progress = Math.min(deal.currentBuyers / deal.minBuyers, 1)

  // ── Main render ──────────────────────────────────────────────────────────
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

        {/* Visual progress bar toward minBuyers */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { flex: progress }]} />
          {/* The remaining unfilled portion — flex: 0 collapses it when full */}
          <View style={{ flex: Math.max(1 - progress, 0) }} />
        </View>

        {!isClosed && !isFull && buyersNeeded > 0 && (
          <Text style={styles.progressHint}>
            {buyersNeeded} more needed to lock this deal
          </Text>
        )}
        {isFull && <Text style={styles.progressHint}>Deal is full</Text>}
      </View>

      {/* Deadline */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Deadline</Text>
        <Text style={styles.sectionValue}>{deal.deadline.toLocaleDateString()}</Text>
      </View>

      {/* Error message from join attempt */}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {/* Join button — shows different states based on deal and user status */}
      {alreadyJoined ? (
        <View style={styles.joinedBanner}>
          <Text style={styles.joinedBannerText}>You're in!</Text>
        </View>
      ) : (
        <TouchableOpacity
          style={[
            styles.joinButton,
            (isClosed || isFull || joining) && styles.joinButtonDisabled,
          ]}
          onPress={handleJoin}
          disabled={isClosed || isFull || joining}
        >
          {joining
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.joinButtonText}>
                {isClosed ? 'Deal closed' : isFull ? 'Deal full' : 'Join Deal'}
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
  backButton: {
    marginTop: 16,
  },
  backButtonText: {
    color: '#FF6B35',
    fontSize: 14,
  },
})
