# Batch

A collaborative bulk-buying app, currently in active development. Built as my first full-stack project to understand how real applications are structured from the client all the way to the cloud.

**Stack:** React Native (Expo) · Firebase Auth · Firestore · Cloud Functions · Stripe · TypeScript

---

## Why I Built This

I wanted a project that forced me to make real architectural decisions, not just follow a tutorial. Batch gave me a reason to think through auth flows, NoSQL schema design, server-side security, and payment handling as connected problems rather than isolated exercises.

The idea came from a genuine frustration: bulk purchasing platforms offer better prices for high-volume orders, but coordinating a group buy manually is a mess. Batch handles that coordination (grouping buyers, tracking commitments, locking orders at deadlines, and splitting costs).

---

## Current Status

| Area | Status |
|---|---|
| User registration + login | Complete |
| Auth guard + session persistence | Complete |
| Firestore user profiles | Complete |
| Feed screen | Skeleton (UI done, Firestore listener pending) |
| Deal creation | In progress |
| Deal joining + commitments | Planned |
| Cloud Functions (deal locking, payments) | Planned |
| Stripe integration | Planned |
| Deployment (Firebase Hosting) | Planned |

---

## Architecture

Batch separates client and server responsibilities clearly. The Expo app handles UI and reads non-sensitive data directly from Firestore. Anything sensitive (payments, deal locking, business rule enforcement) goes through Firebase Cloud Functions, which the client can't bypass.

```
Expo App (Client)
      │
      ├── Reads/writes Firestore directly (non-sensitive data)
      │
      └── Calls Cloud Functions via HTTPS (sensitive operations)
                │
                └── Calls Stripe API (server-side only)
```

```
batch/
├── src/                  # Expo frontend
│   ├── app/              # File-based routes (Expo Router)
│   ├── components/       # Reusable UI components
│   ├── services/         # Firebase config and initialisation
│   └── types/            # Shared TypeScript interfaces
├── functions/            # Firebase Cloud Functions (backend)
├── firestore.rules       # Firestore security rules
└── firebase.json         # Firebase deployment config
```

---

## Tech Stack

**Frontend: Expo + React Native + TypeScript**
Expo's managed environment let me focus on application logic rather than build tooling. TypeScript enforced consistent data shapes across the client and helped catch integration errors early.

**Database: Firestore**
Chosen for its real-time `onSnapshot` listeners (deals update live without polling) and its tight integration with Firebase Auth, where security rules can reference the authenticated user directly.

**Auth: Firebase Auth**
Handles registration, login, token issuance, and session persistence. Tokens are verified server-side in Cloud Functions before any sensitive operation runs.

**Backend: Firebase Cloud Functions**
Serverless functions handle everything the client shouldn't touch: payment capture, deal locking when deadlines expire, and pricing logic. The Stripe secret key never leaves the server.

**Payments: Stripe**
Payment intents are created server-side and only the client secret is returned to the app. This mirrors how production payment flows actually work.

---

## Security Decisions Worth Noting

A few deliberate choices made during development:

- **Generic auth error messages:** login returns "Incorrect email or password" regardless of which field is wrong. Separate messages would allow someone to enumerate which emails are registered.
- **Email trimming, not password trimming:** trailing whitespace on an email causes a silent auth failure; trailing spaces in a password are valid and intentionally preserved.
- **Partial registration cleanup:** if Firebase Auth succeeds but the Firestore profile write fails, the user is immediately signed out rather than left in a broken half-registered state.
- **Stripe secret key server-side only:** the key lives in Cloud Function environment variables and is never referenced in client code.
- **Firestore security rules:** reads and writes are locked to authenticated users, with ownership checks (e.g. only the deal organiser can update a deal).

---

## Deployment Goal

The end goal is a publicly hosted web version (via Firebase Hosting) with a test account so anyone can try it without setting up locally. This also means the Cloud Functions, Firestore rules, and Stripe test mode all need to be in a production-ready state, not just working in dev.
