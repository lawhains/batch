// Feed screen — the main screen users land on after signing in
//
// Planned structure:
//   1. Header     — greeting with the user's name + sign-out button
//   2. Deal list  — real-time FlatList of open deals from Firestore
//   3. Empty state — shown when no deals exist yet
//   4. New Deal button — navigates to the deal creation screen (not built yet)
//
// The Firestore listener is scaffolded but commented out until the
// deals collection and security rules are ready

import { useState, useEffect } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { signOut } from 'firebase/auth'
import { collection, query, where, onSnapshot } from 'firebase/firestore' // wired up below when ready
import { router } from 'expo-router'
import { auth, db } from '@/services/firebase'
import type { Deal } from '@/types'

export default function FeedScreen() {

  // auth.currentUser is safe to read directly here — the auth guard in _layout.tsx
  // guarantees this screen only renders when a user is signed in
  const user = auth.currentUser

  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    // Set up a real-time listener for all open deals.
    // onSnapshot keeps the list live — new deals appear without a page refresh.
    //
    // const q = query(
    //   collection(db, 'deals'),
    //   where('status', '==', 'open')
    //   // TODO: add orderBy('deadline', 'asc') once Firestore index is created
    // )
    //
    // const unsubscribe = onSnapshot(q,
    //   (snapshot) => {
    //     const fetched = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Deal))
    //     setDeals(fetched)
    //     setLoading(false)
    //   },
    //   (err) => {
    //     setError('Failed to load deals. Pull down to retry.')
    //     setLoading(false)
    //   }
    // )
    //
    // return unsubscribe // cancel the listener when the screen unmounts

    // Temporary: skip loading state until Firestore is wired up
    setLoading(false)
  }, [])

  const handleSignOut = async () => {
    // TODO: add a confirmation dialog before signing out
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
          Hey, {user?.displayName ?? 'there'} 👋
        </Text>
        <TouchableOpacity onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>

      {/* Deal list */}
      <FlatList
        data={deals}
        keyExtractor={(item) => item.id}
        contentContainerStyle={deals.length === 0 ? styles.emptyContainer : styles.listContent}
        renderItem={({ item }) => (
          // TODO: extract into a <DealCard /> component in src/components/
          <View style={styles.dealCard}>
            <Text style={styles.dealTitle}>{item.title}</Text>
            <Text style={styles.dealMeta}>
              ${item.pricePerPerson}/person · {item.currentBuyers}/{item.minBuyers} joined
            </Text>
            {/* TODO: show deadline countdown and a "Join" button */}
          </View>
        )}
        ListEmptyComponent={
          // Shown when the deals array is empty (no open deals exist yet)
          <View style={styles.centered}>
            <Text style={styles.emptyText}>No open deals yet.</Text>
            <Text style={styles.emptySubText}>Be the first to create one!</Text>
          </View>
        }
      />

      {/* New Deal button — fixed to the bottom of the screen */}
      {/* TODO: wire up router.push('/create-deal') once that screen exists */}
      <TouchableOpacity style={styles.newDealButton}>
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
  signOutText: {
    color: '#FF6B35',
    fontSize: 14,
  },
  listContent: {
    padding: 16,
  },
  dealCard: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    marginBottom: 12,
  },
  dealTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  dealMeta: {
    fontSize: 13,
    color: '#888',
  },
  emptyContainer: {
    flex: 1, // makes the empty state fill the list area so it centres vertically
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
