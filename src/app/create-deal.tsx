// Deal creation screen — lets an organiser post a new bulk deal.
//
// The user fills in: title, price per person, min buyers, max buyers (optional), deadline.
// Everything else (organizerId, currentBuyers, status, doc ID) is set by the server.
//
// Deal creation runs through the createDeal Cloud Function (not a direct addDoc) so that
// the server can enforce a per-user active deal limit — preventing a single account from
// flooding the platform. Client-side validation still runs first for instant feedback.
//
// Flow: validate → createDeal Cloud Function → router.back()

import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native'
import { httpsCallable } from 'firebase/functions'
import { FirebaseError } from 'firebase/app'
import { router } from 'expo-router'
import { functions } from '@/services/firebase'

export default function CreateDealScreen() {

  const [title, setTitle] = useState('')
  const [pricePerPerson, setPricePerPerson] = useState('')
  const [minBuyers, setMinBuyers] = useState('')
  const [maxBuyers, setMaxBuyers] = useState('')
  const [deadline, setDeadline] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleCreate = async () => {
    setError('')

    const trimmedTitle = title.trim()

    if (!trimmedTitle || !pricePerPerson || !minBuyers || !deadline) {
      setError('Please fill in all required fields')
      return
    }

    const parsedPrice = parseFloat(pricePerPerson)
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      setError('Price per person must be a number greater than 0')
      return
    }

    const parsedMin = parseInt(minBuyers, 10)
    if (isNaN(parsedMin) || parsedMin < 2) {
      setError('Minimum buyers must be at least 2')
      return
    }

    let parsedMax: number | undefined
    if (maxBuyers.trim()) {
      parsedMax = parseInt(maxBuyers, 10)
      if (isNaN(parsedMax) || parsedMax < parsedMin) {
        setError('Maximum buyers must be at least equal to the minimum')
        return
      }
    }

    // new Date("YYYY-MM-DD") parses as UTC midnight — validate before sending to the server
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
      // The createDeal Cloud Function validates everything server-side too and enforces
      // the per-user active deal limit (max 10 open deals at once).
      // We send the deadline as an ISO string — the server converts it to a Firestore Timestamp.
      const createDeal = httpsCallable(functions, 'createDeal')
      await createDeal({
        title: trimmedTitle,
        pricePerPerson: parsedPrice,
        minBuyers: parsedMin,
        maxBuyers: parsedMax ?? null,   // null tells the server there's no cap
        deadline: deadlineDate.toISOString(),
      })

      // Go back to the feed — the onSnapshot listener picks up the new deal automatically
      router.back()

    } catch (e) {
      if (e instanceof FirebaseError) {
        // HttpsError messages from the Cloud Function are user-facing
        setError(e.message)
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >

      <Text style={styles.label}>Title *</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Bulk olive oil order"
        placeholderTextColor="#999"
        value={title}
        onChangeText={setTitle}
        autoCorrect={false}
        editable={!loading}
      />

      <Text style={styles.label}>Price per person ($) *</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 24.99"
        placeholderTextColor="#999"
        value={pricePerPerson}
        onChangeText={setPricePerPerson}
        keyboardType="decimal-pad"
        editable={!loading}
      />

      <Text style={styles.label}>Minimum buyers *</Text>
      <Text style={styles.hint}>Deal only locks if this many people join</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 10"
        placeholderTextColor="#999"
        value={minBuyers}
        onChangeText={setMinBuyers}
        keyboardType="number-pad"
        editable={!loading}
      />

      <Text style={styles.label}>Maximum buyers</Text>
      <Text style={styles.hint}>Leave blank for no cap</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 20"
        placeholderTextColor="#999"
        value={maxBuyers}
        onChangeText={setMaxBuyers}
        keyboardType="number-pad"
        editable={!loading}
      />

      <Text style={styles.label}>Deadline *</Text>
      <Text style={styles.hint}>Format: YYYY-MM-DD</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 2026-06-01"
        placeholderTextColor="#999"
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
    backgroundColor: '#fff',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
    marginBottom: 5,
  },
  hint: {
    fontSize: 12,
    color: '#999',
    marginBottom: 6,
    marginTop: -2,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 14,
    marginBottom: 18,
    fontSize: 16,
    color: '#000',
    backgroundColor: '#fff',
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
