// Registration screen — creates a new user in three steps:
//   1. Firebase Auth  — createUserWithEmailAndPassword (also signs them in automatically)
//   2. Auth profile   — updateProfile to set displayName (otherwise it stays null)
//   3. Firestore      — write a user doc at users/{uid} to match the User type in types/index.ts
//
// Validation runs top-to-bottom before any network calls:
// empty fields -> password length -> passwords match -> Firebase errors

import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { createUserWithEmailAndPassword, updateProfile, signOut } from 'firebase/auth'
import { FirebaseError } from 'firebase/app' // used to narrow the catch type instead of casting to `any`
import { doc, setDoc } from 'firebase/firestore'
import { router } from 'expo-router'
import { auth, db } from '@/services/firebase'

export default function RegisterScreen() {

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('') // catches typos before the user gets locked out
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleRegister = async () => {

    setError('')

    const trimmedName = name.trim()
    const trimmedEmail = email.trim()

    // Check everything is filled before touching the network
    if (!trimmedName || !trimmedEmail || !password || !confirmPassword) {
      setError('Please fill in all fields')
      return
    }

    // Enforce a minimum password length client-side so the user gets
    // instant feedback rather than waiting on a Firebase rejection
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    // Catch a mismatched confirm password before we even try to create the account
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    // Track whether the Auth step succeeded so we can clean up if a later step fails.
    // If we don't do this and e.g. the Firestore write throws, the user would be silently
    // signed in but stuck on this screen — and retrying would hit auth/email-already-in-use.
    let authSucceeded = false

    try {
      // Step 1: Create the Firebase Auth user.
      // This gives us a uid we can use as the Firestore document ID,
      // and also signs the user in automatically on success.
      const userCredential = await createUserWithEmailAndPassword(auth, trimmedEmail, password)
      const user = userCredential.user
      authSucceeded = true

      // Step 2: Set the display name on the Auth profile.
      // Without this, user.displayName would be null everywhere in the app.
      await updateProfile(user, { displayName: trimmedName })

      // Step 3: Write a matching document to Firestore.
      // We use the Firebase Auth uid as the document ID so we can always
      // look up a user's profile with doc(db, 'users', uid).
      // This mirrors the User interface defined in types/index.ts.
      await setDoc(doc(db, 'users', user.uid), {
        id: user.uid,
        displayName: trimmedName,
        email: trimmedEmail,
        // avatarUrl is optional in the User type, so we leave it out for now
      })

      // All three steps succeeded — send them to the app
      router.replace('/')

    } catch (e) {
      // If Auth already created the user before the error occurred, sign them out
      // so they land back at login in a clean state rather than being silently
      // authenticated with incomplete profile data
      if (authSucceeded) {
        await signOut(auth).catch(() => {}) // best-effort — ignore if this also fails
      }

      // Narrowing to FirebaseError gives us a typed e.code rather than casting
      // the whole error to `any`, which would bypass TypeScript's type system
      if (e instanceof FirebaseError) {
        if (e.code === 'auth/email-already-in-use') {
          // Safe to be specific here — an attacker could discover this just by trying to log in
          setError('An account with this email already exists')

        } else if (e.code === 'auth/invalid-email') {
          setError('Please enter a valid email address')

        } else if (e.code === 'auth/weak-password') {
          // Firebase's own minimum is 6 characters — this fires if somehow
          // our client-side 8-char check is bypassed
          setError('Password is too weak. Please choose a stronger one.')

        } else if (e.code === 'auth/network-request-failed') {
          setError('Network error. Check your connection and try again.')

        } else {
          setError('Something went wrong. Please try again.')
        }
      } else {
        // Non-Firebase error — covers unexpected throws from Firestore or updateProfile
        setError('Something went wrong. Please try again.')
      }

    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create Account</Text>

      <TextInput
        style={styles.input}
        placeholder="Name"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"  // capitalises each word — correct for a name field ("John Smith" not "John smith")
        autoComplete="name"
        autoCorrect={false}
        editable={!loading}
      />

      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}       // stops autocorrect silently changing the email
        keyboardType="email-address"
        autoComplete="email"
        editable={!loading}
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password" // "new" (not "current") tells the OS this is registration,
                                    // which prompts password managers to save rather than autofill
        editable={!loading}
      />

      <TextInput
        style={styles.input}
        placeholder="Confirm Password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        editable={!loading}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleRegister}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.buttonText}>Create Account</Text>
        }
      </TouchableOpacity>

      {/* push() so the user can go back to login if they already have an account */}
      <TouchableOpacity
        style={styles.link}
        onPress={() => router.push('/login')}
        disabled={loading}
      >
        <Text style={styles.linkText}>Already have an account? Log in</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 32,
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
    backgroundColor: '#FF6B3580', // same orange at ~50% opacity
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
