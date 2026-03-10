// Firebase initialisation — sets up Auth, Firestore, and Functions and exports them for use across the app.
// All screens import { auth, db, functions } from here rather than initialising Firebase themselves.
//
// In development, set EXPO_PUBLIC_USE_EMULATOR=true in .env to route traffic through
// the local Firebase Emulator Suite instead of production.

import { Platform } from 'react-native'
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'

// values come from .env (never hardcode!)
const app = initializeApp({
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
})

export const auth = getAuth(app)
export const db = getFirestore(app)
export const functions = getFunctions(app)

if (process.env.EXPO_PUBLIC_USE_EMULATOR === 'true') {
  // Android emulator runs in its own VM — 'localhost' refers to the emulator itself,
  // not the host machine. 10.0.2.2 is Android's special alias for the host's localhost.
  // iOS simulator shares the host's network stack, so plain 'localhost' works there.
  const host = Platform.OS === 'android' ? '10.0.2.2' : 'localhost'

  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(db, host, 8080)
  connectFunctionsEmulator(functions, host, 5001)
}
