// My Deals screen — two sections:
//   1. Deals I'm organizing — live onSnapshot on deals where organizerId == uid
//   2. Deals I've joined   — live onSnapshot on my commitments, then a batch getDocs
//                            for the actual deal docs whenever the commitment list changes
//
// The joined deals fetch uses getDocs (not onSnapshot) because we can't attach a
// live listener to a dynamic list of doc IDs. A fresh fetch on each commitments change
// is simple and accurate enough for this screen.

import { useState, useEffect } from 'react'
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native'
import { collection, query, where, onSnapshot, getDocs, documentId } from 'firebase/firestore'
import { router } from 'expo-router'
import { auth, db } from '@/services/firebase'
import DealCard from '@/components/DealCard'
import type { Deal } from '@/types'
import { mapDeal } from '@/utils/mapDeal'

export default function MyDealsScreen() {

  // Safe to assert — auth guard in _layout.tsx ensures a user is always signed in
  const uid = auth.currentUser!.uid

  const [myDeals, setMyDeals] = useState<Deal[]>([])
  const [joinedDeals, setJoinedDeals] = useState<Deal[]>([])
  const [loadingOrganized, setLoadingOrganized] = useState(true)
  const [loadingJoined, setLoadingJoined] = useState(true)

  // ── Listener 1: deals I'm organizing ─────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, 'deals'), where('organizerId', '==', uid))

    const unsubscribe = onSnapshot(q,
      (snap) => {
        setMyDeals(snap.docs.map(mapDeal))
        setLoadingOrganized(false)
      },
      () => setLoadingOrganized(false)
    )

    return unsubscribe
  }, [uid])

  // ── Listener 2: commitments → fetch joined deal docs ─────────────────────
  useEffect(() => {
    const q = query(collection(db, 'commitments'), where('userId', '==', uid))

    const unsubscribe = onSnapshot(q,
      async (snap) => {
        const dealIds = snap.docs.map(d => d.data().dealId as string)

        if (dealIds.length === 0) {
          setJoinedDeals([])
          setLoadingJoined(false)
          return
        }

        try {
          // Firestore 'in' queries cap at 30 values. If a user has joined 31+ deals,
          // a single query would fail. Chunk the IDs into groups of 30 and run
          // parallel queries so we stay under the limit at any scale.
          const FIRESTORE_IN_LIMIT = 30
          const chunks: string[][] = []
          for (let i = 0; i < dealIds.length; i += FIRESTORE_IN_LIMIT) {
            chunks.push(dealIds.slice(i, i + FIRESTORE_IN_LIMIT))
          }

          const snapshots = await Promise.all(
            chunks.map(chunk =>
              getDocs(query(collection(db, 'deals'), where(documentId(), 'in', chunk)))
            )
          )

          const deals = snapshots.flatMap(snap => snap.docs.map(mapDeal))
          setJoinedDeals(deals)
        } catch {
          // silently fail — the section stays empty rather than crashing the screen
        } finally {
          setLoadingJoined(false)
        }
      },
      () => setLoadingJoined(false)
    )

    return unsubscribe
  }, [uid])

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loadingOrganized || loadingJoined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#FF6B35" />
      </View>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <ScrollView contentContainerStyle={styles.container}>

      <Text style={styles.sectionTitle}>
        Organizing ({myDeals.length})
      </Text>

      {myDeals.length === 0
        ? <Text style={styles.empty}>You haven't created any deals yet.</Text>
        : myDeals.map(deal => (
            <DealCard
              key={deal.id}
              deal={deal}
              onPress={() => router.push(`/deal/${deal.id}`)}
            />
          ))
      }

      <View style={styles.divider} />

      <Text style={styles.sectionTitle}>
        Joined ({joinedDeals.length})
      </Text>

      {joinedDeals.length === 0
        ? <Text style={styles.empty}>You haven't joined any deals yet.</Text>
        : joinedDeals.map(deal => (
            <DealCard
              key={deal.id}
              deal={deal}
              onPress={() => router.push(`/deal/${deal.id}`)}
            />
          ))
      }

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
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    color: '#333',
  },
  empty: {
    fontSize: 14,
    color: '#aaa',
    marginBottom: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#eee',
    marginVertical: 20,
  },
})
