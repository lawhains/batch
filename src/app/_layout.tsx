import { Stack } from 'expo-router'

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Batch' }} />
      <Stack.Screen name="(auth)/login" options={{ title: 'Log In', headerShown: false }} />
      <Stack.Screen name="(auth)/register" options={{ title: 'Register', headerShown: false }} />
    </Stack>
  )
}