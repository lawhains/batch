// Registration screen — creates a new user in three steps:
//   1. Firebase Auth  — createUserWithEmailAndPassword (also signs them in automatically)
//   2. Auth profile   — updateProfile to set displayName (otherwise it stays null)
//   3. Firestore      — write a user doc at users/{uid} to match the User type in types/index.ts
//
// Validation runs top-to-bottom before any network calls:
// empty fields -> password strength -> passwords match -> Firebase errors

import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native'
import { createUserWithEmailAndPassword, updateProfile, signOut } from 'firebase/auth'
import { FirebaseError } from 'firebase/app'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { router } from 'expo-router'
import { auth, db } from '@/services/firebase'

// ── Password strength ─────────────────────────────────────────────────────────
// Returns the first failing rule as a user-facing string, or null if the password
// is strong enough. Checked before any network call for instant feedback.
//
// Requirements (in order of check):
//   - 8+ characters
//   - At least one uppercase letter
//   - At least one lowercase letter
//   - At least one number
//   - At least one special character
//
// These rules are intentionally client-side only — Firebase's own minimum is just
// 6 characters, so we enforce a stronger policy here. A determined attacker hitting
// the API directly would get past this check, but they'd still hit rate limiting and
// can't create accounts with weak passwords through the app.
function getPasswordError(password: string): string | null {
  if (password.length < 8)          return 'Must be at least 8 characters'
  if (!/[A-Z]/.test(password))      return 'Must contain an uppercase letter'
  if (!/[a-z]/.test(password))      return 'Must contain a lowercase letter'
  if (!/[0-9]/.test(password))      return 'Must contain a number'
  if (!/[^A-Za-z0-9]/.test(password)) return 'Must contain a special character (e.g. !@#$%)'
  return null
}

export default function RegisterScreen() {

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [agreedToTos, setAgreedToTos] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleRegister = async () => {

    setError('')

    const trimmedName = name.trim()
    const trimmedEmail = email.trim()

    if (!trimmedName || !trimmedEmail || !password || !confirmPassword) {
      setError('Please fill in all fields')
      return
    }

    // Check password strength before anything else
    const passwordError = getPasswordError(password)
    if (passwordError) {
      setError(passwordError)
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (!agreedToTos) {
      setError('You must agree to the Terms of Service to create an account')
      return
    }

    setLoading(true)

    let authSucceeded = false

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, trimmedEmail, password)
      const user = userCredential.user
      authSucceeded = true

      await updateProfile(user, { displayName: trimmedName })

      await setDoc(doc(db, 'users', user.uid), {
        id: user.uid,
        displayName: trimmedName,
        email: trimmedEmail,
        // Record TOS agreement with a server-side timestamp so there's an
        // auditable record of when they accepted — important for a money-handling app
        agreedToTos: true,
        agreedToTosAt: serverTimestamp(),
      })

      router.replace('/')

    } catch (e) {
      if (authSucceeded) {
        await signOut(auth).catch(() => {})
      }

      if (e instanceof FirebaseError) {
        if (e.code === 'auth/email-already-in-use') {
          setError('An account with this email already exists')
        } else if (e.code === 'auth/invalid-email') {
          setError('Please enter a valid email address')
        } else if (e.code === 'auth/weak-password') {
          setError('Password is too weak. Please choose a stronger one.')
        } else if (e.code === 'auth/network-request-failed') {
          setError('Network error. Check your connection and try again.')
        } else {
          setError('Something went wrong. Please try again.')
        }
      } else {
        setError('Something went wrong. Please try again.')
      }

    } finally {
      setLoading(false)
    }
  }

  return (
    // ScrollView so the form stays accessible when the keyboard is up on smaller phones
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >

      {/* App identity */}
      <Text style={styles.appName}>Batch</Text>
      <Text style={styles.title}>Create Account</Text>

      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        placeholder="Your full name"
        placeholderTextColor="#999"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoComplete="name"
        autoCorrect={false}
        editable={!loading}
      />

      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        placeholder="you@example.com"
        placeholderTextColor="#999"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        editable={!loading}
      />

      <Text style={styles.label}>Password</Text>
      <Text style={styles.hint}>8+ characters, uppercase, lowercase, number, special character</Text>
      <TextInput
        style={styles.input}
        placeholder="Create a strong password"
        placeholderTextColor="#999"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        editable={!loading}
      />

      <Text style={styles.label}>Confirm Password</Text>
      <TextInput
        style={styles.input}
        placeholder="Re-enter your password"
        placeholderTextColor="#999"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        editable={!loading}
      />

      {/* TOS agreement — stored on the user doc with a timestamp for audit purposes.
          The actual TOS and Privacy Policy documents should be drafted with legal
          counsel before the app goes live, since Batch handles real payments. */}
      <TouchableOpacity
        style={styles.checkboxRow}
        onPress={() => setAgreedToTos(!agreedToTos)}
        disabled={loading}
        activeOpacity={0.7}
      >
        <View style={[styles.checkbox, agreedToTos && styles.checkboxChecked]}>
          {agreedToTos && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={styles.checkboxLabel}>
          I agree to the{' '}
          <Text style={styles.checkboxLink}>Terms of Service</Text>
          {' '}and{' '}
          <Text style={styles.checkboxLink}>Privacy Policy</Text>
        </Text>
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, (loading || !agreedToTos) && styles.buttonDisabled]}
        onPress={handleRegister}
        disabled={loading || !agreedToTos}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.buttonText}>Create Account</Text>
        }
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.link}
        onPress={() => router.push('/login')}
        disabled={loading}
      >
        <Text style={styles.linkText}>Already have an account? Log in</Text>
      </TouchableOpacity>

    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    paddingTop: 60,
    paddingBottom: 40,
    backgroundColor: '#fff',
  },
  appName: {
    fontSize: 40,
    fontWeight: '800',
    color: '#FF6B35',
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: '#333',
    marginBottom: 28,
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
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 18,
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: '#ccc',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: '#FF6B35',
    borderColor: '#FF6B35',
  },
  checkmark: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  checkboxLabel: {
    fontSize: 14,
    color: '#333',
    flex: 1,
    lineHeight: 20,
  },
  checkboxLink: {
    color: '#FF6B35',
    fontWeight: '600',
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
    marginTop: 4,
  },
  buttonDisabled: {
    backgroundColor: '#FF6B3580',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  link: {
    marginTop: 20,
    alignItems: 'center',
  },
  linkText: {
    color: '#FF6B35',
    fontSize: 14,
  },
})
