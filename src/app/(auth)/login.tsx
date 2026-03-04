// Login screen — signs an existing user in with email and password:
//   1. Client-side validation — empty fields caught before touching the network
//   2. Firebase Auth          — signInWithEmailAndPassword
//   3. Navigation             — router.replace('/') removes this screen from the stack
//
// Error messages are deliberately generic for credential failures to prevent user enumeration

import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { FirebaseError } from 'firebase/app' // used to narrow the catch type instead of casting to `any`
import { router } from 'expo-router'
import { auth } from '@/services/firebase'

export default function LoginScreen() {

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')        // empty string means no error is shown
  const [loading, setLoading] = useState(false) // true while we're waiting on Firebase

  const handleLogin = async () => {

    // Wipe the previous error so it doesn't linger if the user retries
    setError('')

    // Trim whitespace from the email — a copy-paste or autofill can sneak in a
    // trailing space, which Firebase would treat as a different address entirely.
    // We don't trim the password though, since spaces in passwords are valid.
    const trimmedEmail = email.trim()

    // Catch empty fields before we even touch the network
    if (!trimmedEmail || !password) {
      setError('Please fill in all fields')
      return
    }

    // Lock the UI while the request is in flight so the user can't
    // accidentally fire off multiple login attempts at once
    setLoading(true)

    try {
      // The actual sign-in call. Firebase handles the credential check on their
      // servers and, if it succeeds, stores a session token locally so the user
      // stays logged in across app restarts.
      await signInWithEmailAndPassword(auth, trimmedEmail, password)

      // replace() instead of push() removes this screen from the navigation stack,
      // so hitting the back button from home won't drop them back at the login screen
      router.replace('/')

    } catch (e) {
      // Narrowing to FirebaseError gives us a typed e.code rather than casting
      // the whole error to `any`, which would bypass TypeScript's type system
      if (e instanceof FirebaseError) {
        // We show the same message whether the email doesn't exist or the password
        // is wrong — separate messages would let someone probe which emails are registered
        if (
          e.code === 'auth/invalid-credential' || // what the newer Firebase SDK sends
          e.code === 'auth/user-not-found' ||     // older SDK: email not in the system
          e.code === 'auth/wrong-password'        // older SDK: email exists, password doesn't match
        ) {
          setError('Incorrect email or password')

        } else if (e.code === 'auth/invalid-email') {
          // Catches malformed emails that slip past the empty-field check
          setError('Please enter a valid email address')

        } else if (e.code === 'auth/too-many-requests') {
          // Firebase locks the account temporarily after too many bad attempts
          setError('Too many attempts. Please wait a moment and try again.')

        } else if (e.code === 'auth/network-request-failed') {
          // Worth separating this one out — the fix is "check your wifi", not "check your password"
          setError('Network error. Check your connection and try again.')

        } else {
          setError('Something went wrong. Please try again.')
        }
      } else {
        // Non-Firebase error — shouldn't happen here, but covers unexpected throws
        setError('Something went wrong. Please try again.')
      }

    } finally {
      // finally runs whether we succeeded or failed, so the button always gets re-enabled
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome Back</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"       // stops iOS capitalising the first letter ("User@..." instead of "user@...")
        autoCorrect={false}         // stops autocorrect silently mangling the email address
        keyboardType="email-address"
        autoComplete="email"        // lets password managers and autofill know what this field is for
        editable={!loading}         // lock the field while the request is running
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry             // masks the input and disables copy on most platforms
        autoComplete="current-password" // "current" (not "new") tells the OS this is a login, not registration
        editable={!loading}
      />

      {/* Only renders when there's actually an error to show */}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* Style array lets us layer the disabled style on top of the base style when loading */}
      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleLogin}
        disabled={loading}
      >
        {/* Swap the text for a spinner while we wait — clearer than a frozen button */}
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.buttonText}>Log In</Text>
        }
      </TouchableOpacity>

      {/* push() here (not replace) so the user can go back if they already have an account */}
      <TouchableOpacity
        style={styles.link}
        onPress={() => router.push('/register')}
        disabled={loading}
      >
        <Text style={styles.linkText}>Don't have an account? Sign up</Text>
      </TouchableOpacity>
    </View>
  )
}

// StyleSheet.create() optimises styles into numeric IDs at runtime rather than
// recreating plain objects on every render the way inline styles would
const styles = StyleSheet.create({
  container: {
    flex: 1,                  // fills the full screen
    padding: 24,
    justifyContent: 'center', // vertically centres the form
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
    backgroundColor: '#FF6B3580', // same orange but ~50% opacity (the 80 at the end is hex for opacity)
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
