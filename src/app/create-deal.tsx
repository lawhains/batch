// Deal creation screen — lets an organiser post a new bulk deal
//
// The user fills in: title, price per person, min buyers, max buyers (optional), deadline.
// Everything else (organizerId, currentBuyers, status, doc ID) is set automatically on write.
//
// Validation runs top-to-bottom before any network call so we fail fast on the client.
// The Firestore security rules enforce the same constraints server-side — that matters because
// anyone can hit the Firestore REST API directly and skip this form entirely.
//
// Flow: validate → addDoc → router.back() (the feed's onSnapshot picks up the new deal live)

import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native'
import { addDoc, collection, Timestamp } from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
import { router } from 'expo-router'
import { auth, db } from '@/services/firebase'

export default function CreateDealScreen() {

  const [title, setTitle] = useState('')
  const [pricePerPerson, setPricePerPerson] = useState('')
  const [minBuyers, setMinBuyers] = useState('')
  const [maxBuyers, setMaxBuyers] = useState('')   // blank = no cap, stored as undefined in Firestore
  const [deadline, setDeadline] = useState('')     // user types YYYY-MM-DD
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleCreate = async () => {
    setError('')

    // Trim early so "   " doesn't pass the empty-field check below
    const trimmedTitle = title.trim()

    // Catch obviously empty fields before touching the network
    if (!trimmedTitle || !pricePerPerson || !minBuyers || !deadline) {
      setError('Please fill in all required fields')
      return
    }

    // parseFloat handles decimals ("9.99") — parseInt would strip the cents
    const parsedPrice = parseFloat(pricePerPerson)
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      setError('Price per person must be a number greater than 0')
      return
    }

    // Radix 10 prevents JS from misreading inputs like "08" as octal in older environments
    const parsedMin = parseInt(minBuyers, 10)
    if (isNaN(parsedMin) || parsedMin < 2) {
      setError('Minimum buyers must be at least 2')
      return
    }

    // Max buyers is optional — only parse and validate it if the user actually typed something
    let parsedMax: number | undefined
    if (maxBuyers.trim()) {
      parsedMax = parseInt(maxBuyers, 10)
      if (isNaN(parsedMax) || parsedMax < parsedMin) {
        setError('Maximum buyers must be at least equal to the minimum')
        return
      }
    }

    // new Date("YYYY-MM-DD") parses as UTC midnight, so deadlines entered as today's date will
    // correctly fail the future check for most users (unless they're at UTC+0 past midnight)
    const deadlineDate = new Date(deadline)
    if (isNaN(deadlineDate.getTime())) {
      setError('Please enter a valid date (YYYY-MM-DD)')
      return
    }
    if (deadlineDate <= new Date()) {
      setError('Deadline must be in the future')
      return
    }

    setLoading(true)

    try {
      // addDoc auto-generates the document ID — we don't need to know it upfront, and it avoids
      // any risk of ID collisions that could happen if we generated IDs client-side
      await addDoc(collection(db, 'deals'), {
        // Non-null assertion is safe here — the auth guard in _layout.tsx ensures a user
        // is always signed in before this screen renders
        organizerId: auth.currentUser!.uid,
        title: trimmedTitle,
        pricePerPerson: parsedPrice,
        minBuyers: parsedMin,
        // Spread trick: ...false is a no-op, so maxBuyers is only included in the doc if the
        // user provided one. Writing maxBuyers: undefined would still store the key in Firestore.
        ...(parsedMax !== undefined && { maxBuyers: parsedMax }),
        currentBuyers: 0,
        // Firestore stores its own Timestamp type — plain JS Date objects get rejected
        deadline: Timestamp.fromDate(deadlineDate),
        status: 'open' as const,
      })

      // Go back to the feed rather than push — keeps the nav stack clean and avoids
      // a double back-press to get home. The feed's onSnapshot picks up the new deal automatically.
      router.back()

    } catch (e) {
      // Separate FirebaseError from unexpected errors so we can be specific if needed later
      if (e instanceof FirebaseError) {
        setError('Failed to create deal. Please try again.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      // Always re-enable the button, whether the write succeeded or failed
      setLoading(false)
    }
  }

  return (
    // ScrollView keeps the form accessible when the keyboard pushes content up on smaller screens.
    // keyboardShouldPersistTaps="handled" lets taps on the Create button register even while
    // the keyboard is open (without it, the first tap just dismisses the keyboard).
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

      <TextInput
        style={styles.input}
        placeholder="Title *"
        value={title}
        onChangeText={setTitle}
        autoCorrect={false}   // deal titles aren't natural language — autocorrect would mangle them
        editable={!loading}
      />

      <TextInput
        style={styles.input}
        placeholder="Price per person ($) *"
        value={pricePerPerson}
        onChangeText={setPricePerPerson}
        keyboardType="decimal-pad"   // decimal-pad shows digits + "." but no minus sign
        editable={!loading}
      />

      <TextInput
        style={styles.input}
        placeholder="Minimum buyers * (e.g. 10)"
        value={minBuyers}
        onChangeText={setMinBuyers}
        keyboardType="number-pad"
        editable={!loading}
      />

      <TextInput
        style={styles.input}
        placeholder="Maximum buyers (optional — leave blank for no cap)"
        value={maxBuyers}
        onChangeText={setMaxBuyers}
        keyboardType="number-pad"
        editable={!loading}
      />

      <TextInput
        style={styles.input}
        placeholder="Deadline * (YYYY-MM-DD)"
        value={deadline}
        onChangeText={setDeadline}
        keyboardType="numbers-and-punctuation"
        editable={!loading}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleCreate}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.buttonText}>Create Deal</Text>
        }
      </TouchableOpacity>

    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 14,
    marginBottom: 14,
    fontSize: 16,
  },
  error: {
    color: '#cc0000',
    fontSize: 13,
    marginBottom: 10,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#FF6B35',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: '#FF6B3580',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
})
