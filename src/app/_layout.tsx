// Root layout — three responsibilities:
//   1. Auth guard: watches Firebase auth state and redirects to the right screen
//   2. Navigation shell: defines the Stack navigator and registers all screens
//   3. Stripe context: wraps the entire app in StripeProvider so any screen can
//      use the Payment Sheet without prop-drilling
//
// The guard lives here so it runs across the entire app automatically —
// no individual screen needs to handle its own redirect logic

import { useEffect, useState } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { onAuthStateChanged } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { StripeProvider } from '@stripe/stripe-react-native'
import { auth } from '@/services/firebase'

export default function RootLayout() {

  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false) // false until Firebase resolves the initial session

  const router = useRouter()
  const segments = useSegments() // reflects the current route as an array, e.g. ['(auth)', 'login']

  // Subscribe to Firebase auth state changes for the lifetime of the app.
  // onAuthStateChanged fires immediately with the cached session (if any),
  // so we know the auth state before rendering anything.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser)
      setAuthReady(true) // we now know definitively whether there's a signed-in user
    })
    return unsubscribe // cancel the listener when the layout unmounts
  }, [])

  // Re-run the redirect check whenever auth state or the active route changes.
  // This handles three cases:
  //   - App cold start: wait for authReady, then redirect if needed
  //   - Sign in: user becomes non-null while on an auth screen -> go to feed
  //   - Sign out: user becomes null while on a protected screen -> go to login
  useEffect(() => {
    if (!authReady) return

    // segments[0] === '(auth)' when the user is on /login or /register.
    // Route groups (folders with parens) are transparent in the URL but visible in segments.
    const onAuthScreen = segments[0] === '(auth)'

    if (!user && !onAuthScreen) {
      // Not signed in and trying to reach a protected screen
      router.replace('/login')
    } else if (user && onAuthScreen) {
      // Already signed in but landed on login/register (e.g. pressed back)
      router.replace('/')
    }
  }, [user, authReady, segments])

  // Block rendering until we know the auth state.
  // Without this, there's a visible flash of the feed screen before the
  // redirect to login fires — this is known as the "auth flash" problem.
  if (!authReady) return null

  // StripeProvider must wrap the entire navigation tree so any screen can call
  // useStripe(). The publishableKey is the test/live key prefixed with EXPO_PUBLIC_
  // so Expo bundles it into the client build (never use the secret key here).
  // merchantIdentifier must match the value in app.json (used for Apple Pay).
  return (
    <StripeProvider
      publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!}
      merchantIdentifier="merchant.com.batch"
    >
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)/register" options={{ headerShown: false }} />
        {/* Header shown here — gives a back arrow to the feed automatically */}
        <Stack.Screen name="create-deal" options={{ title: 'New Deal' }} />
        {/* Dynamic route — Expo Router maps deal/[id].tsx to this pattern */}
        <Stack.Screen name="deal/[id]" options={{ title: 'Deal Details' }} />
        <Stack.Screen name="my-deals" options={{ title: 'My Deals' }} />
      </Stack>
    </StripeProvider>
  )
}
