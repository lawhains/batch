// Login screen — signs an existing user in with email and password:
//   1. Client-side validation — empty fields caught before touching the network
//   2. Firebase Auth          — signInWithEmailAndPassword
//   3. Navigation             — router.replace('/') removes this screen from the stack
//
// Error messages are deliberately generic for credential failures to prevent user enumeration

import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { FirebaseError } from 'firebase/app'
import { router } from 'expo-router'
import { auth } from '@/services/firebase'

export default function LoginScreen() {

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    setError('')

    const trimmedEmail = email.trim()

    if (!trimmedEmail || !password) {
      setError('Please fill in all fields')
      return
    }

    setLoading(true)

    try {
      await signInWithEmailAndPassword(auth, trimmedEmail, password)
      router.replace('/')

    } catch (e) {
      if (e instanceof FirebaseError) {
        if (
          e.code === 'auth/invalid-credential' ||
          e.code === 'auth/user-not-found' ||
          e.code === 'auth/wrong-password'
        ) {
          // Deliberately generic — separate messages would let someone probe which emails are registered
          setError('Incorrect email or password')

        } else if (e.code === 'auth/invalid-email') {
          setError('Please enter a valid email address')

        } else if (e.code === 'auth/too-many-requests') {
          setError('Too many attempts. Please wait a moment and try again.')

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
    <View style={styles.container}>

      {/* App identity */}
      <Text style={styles.appName}>Batch</Text>
      <Text style={styles.title}>Welcome Back</Text>

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
      <TextInput
        style={styles.input}
        placeholder="Your password"
        placeholderTextColor="#999"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        editable={!loading}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleLogin}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.buttonText}>Log In</Text>
        }
      </TouchableOpacity>

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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
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
