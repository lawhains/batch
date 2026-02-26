# Batch

## About File Structure
### Architecture
uses a monorepo structure where the Expo app serves as the frontend and Firebase Cloud Functions serve as the backend. While both live in the same repository, they are deployed and executed independently.
- Why Firebase Functions as backend — no server to manage, automatic scaling, and tight integration with Firestore and Auth.
- Where the backend logic lives — all sensitive operations (payment capture, deal locking, Stripe secret key usage) live exclusively in /functions and are never exposed to the client.
- A simple architecture diagram in text
Expo App (client)
     ↓ reads/writes
Firestore (database)
     ↓ triggers
Cloud Functions (server)
     ↓ calls
Stripe API (payments)

