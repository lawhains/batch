// Firebase Cloud Functions — backend logic for Batch
//
// Nothing is deployed here yet. The first functions will handle:
//   1. Deal locking  — triggered when currentBuyers >= minBuyers, or when the deadline passes
//   2. Stripe        — creating payment intents server-side and capturing/releasing them
//
// Using Cloud Functions for these instead of client-side code means the Stripe secret key
// never touches the app, and business rules can't be bypassed by a crafty REST API call.

const { setGlobalOptions } = require('firebase-functions')

// Cap concurrent instances to keep costs predictable during development
setGlobalOptions({ maxInstances: 10 })
