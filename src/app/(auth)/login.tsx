import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { router } from 'expo-router'
import { auth } from '@/services/firebase'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    // Clear any previous error before each attempt
    setError('')

    // Basic client-side validation before touching Firebase
    if (!email || !password) {
      setError('Please fill in all fields')
      return
    }

    setLoading(true)

    try {
      await signInWithEmailAndPassword(auth, email, password)
      router.replace('/')   // removes login from navigation stack — back button won't return here
    } catch (e: any) {
      // Deliberately generic — don't tell attacker whether the email or password was wrong
      if (
        e.code === 'auth/invalid-credential' ||
        e.code === 'auth/user-not-found' ||
        e.code === 'auth/wrong-password'
      ) {
        setError('Incorrect email or password')
      } else if (e.code === 'auth/too-many-requests') {
        setError('Too many attempts. Please wait a moment and try again.')
      } else if (e.code === 'auth/network-request-failed') {
        setError('Network error. Check your connection and try again.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      // Always re-enable the button whether login succeeded or failed
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
        autoCapitalize="none"
        autoCorrect={false}           // prevents iOS autocorrect mangling email addresses
        keyboardType="email-address"
        editable={!loading}           // prevent editing while request is in flight
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        editable={!loading}
      />

      {/* Only renders when there is an error — null renders nothing */}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleLogin}
        disabled={loading}            // prevents multiple simultaneous Firebase calls
      >
        {loading
          ? <ActivityIndicator color="#fff" />   // visual feedback while request is in flight
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
    backgroundColor: '#FF6B3580',   // 50% opacity version of brand orange — visually signals disabled
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