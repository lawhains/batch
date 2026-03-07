// Feed screen — the main screen users land on after signing in
//
// Structure:
//   1. Header     — greeting with the user's name + sign-out button
//   2. Deal list  — real-time FlatList of open deals from Firestore
//   3. Empty state — shown when no open deals exist yet
//   4. New Deal button — navigates to the create-deal screen

import { useState, useEffect } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { signOut } from 'firebase/auth'
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore'
import { router } from 'expo-router'
import { auth, db } from '@/services/firebase'
import type { Deal } from '@/types'
import DealCard from '@/components/DealCard'
import { mapDeal } from '@/utils/mapDeal'

export default function FeedScreen() {

  // auth.currentUser is safe to read directly here — the auth guard in _layout.tsx
  // guarantees this screen only renders when a user is signed in
  const user = auth.currentUser

  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    // Query for all open deals, sorted by soonest deadline first.
    // onSnapshot keeps this live — any new deal posted by any user appears automatically.
    // This uses the composite index on (status ASC, deadline ASC) defined in
    // firestore.indexes.json — Firestore would reject the query without it.
    const q = query(
      collection(db, 'deals'),
      where('status', '==', 'open'),
      orderBy('deadline', 'asc')
    )

    const unsubscribe = onSnapshot(q,
      (snapshot) => {
        const fetched = snapshot.docs.map(mapDeal)
        setDeals(fetched)
        setLoading(false)
      },
      () => {
        setError('Failed to load deals. Please refresh.')
        setLoading(false)
      }
    )

    return unsubscribe // cancel the listener when the screen unmounts
  }, [])

  const handleSignOut = async () => {
    await signOut(auth)
    // No manual navigation needed — the onAuthStateChanged listener in _layout.tsx
    // detects the sign-out and redirects to login automatically
  }

  // ── Loading state ────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#FF6B35" />
      </View>
    )
  }

  // ── Error state ──────────────────────────────────────────────
  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    )
  }

  // ── Main render ──────────────────────────────────────────────
  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>
          Hey, {user?.displayName ?? 'there'}
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => router.push('/my-deals')}>
            <Text style={styles.headerAction}>My deals</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSignOut}>
            <Text style={styles.headerAction}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Deal list */}
      <FlatList
        data={deals}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, deals.length === 0 && styles.emptyContainer]}
        renderItem={({ item }) => (
          <DealCard
            deal={item}
            onPress={() => router.push(`/deal/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.emptyText}>No open deals yet.</Text>
            <Text style={styles.emptySubText}>Be the first to create one!</Text>
          </View>
        }
      />

      {/* New Deal button */}
      <TouchableOpacity
        style={styles.newDealButton}
        onPress={() => router.push('/create-deal')}
      >
        <Text style={styles.newDealButtonText}>+ New Deal</Text>
      </TouchableOpacity>

    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,   // TODO: replace with useSafeAreaInsets for proper notch handling
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  greeting: {
    fontSize: 20,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 16,
  },
  headerAction: {
    color: '#FF6B35',
    fontSize: 14,
  },
  listContent: {
    padding: 16,
  },
  emptyContainer: {
    flex: 1,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#888',
    marginBottom: 4,
    textAlign: 'center',
  },
  emptySubText: {
    fontSize: 13,
    color: '#aaa',
    textAlign: 'center',
  },
  errorText: {
    color: '#cc0000',
    fontSize: 14,
    textAlign: 'center',
  },
  newDealButton: {
    margin: 16,
    backgroundColor: '#FF6B35',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  newDealButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
})
