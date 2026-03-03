# Batch
An **in-progress** collaborative bulk-buying app built to learn and understand full-stack development from client to cloud.
Built with Expo (React Native) and Firebase using a monorepo architecture.

## Project Purpose

### Why I am Building This
Batch is my first full-stack application. I built it to:
- Learn how frotend and backend systems interact and work together
- Understand authentication and authorization flows
- Design a real-world database schema
- Implement secure server-side logic
- Work with cloud infanstructure ("serverless architecture")
- Deploy a production-style app with separated client/server responsibilities

I intentionally persued this project to move beyond small scripts and explore how modern full-stack applications are structured in industry.

## Inspiration
The idea of Batch came from my expereience with the inefficiency of individual purchases when buying in bulk. Many platforms offer discounts for high-volume purchases, but coordinating group orders manually is inconvenient.

Consequently, batch explores:
- Coordinated group purchasing
- Tiered pricing logic
- Shared cost calculation
- Deadline-based order locking
- Secure payment handling

My inital goal is to simulate how a real-world collaborative commerce platform might operate.

## Tech Stack (With Detailed Explanation)
This project uses a modern serverless full-stack architecture.

### Frontend: Expo, React Native, and TypeScript

#### Expo
- Provides a managed React Native environment
- Simplifies development and deployment
- Enables cross-platform mobile support
- Chosen to focus on application logic rather than build tooling

#### React Native
- Component-based UI architecture
- State management for dynamic group updates
- Handles client-side form validation and rendering

#### TypeScript
- Static type checking
- Improves code reliability and maintainability
- Encourages better interface and data modeling

### Backend: Firebase Cloud Functions

#### Why Use Firebase Cloud Functions?
- No server to manage
- Automatic scaling
- Serverless architecture
- Tight integration with Firestore and Firebase Auth
- Secure environment variables for secret keys

Cloud Functions are used to:
- Handle sensitive operations
- Perform server-side validation
- Process payments
- Lock deals when deadlines expire
- Enforce pricing logic

All sensitive operations (payment capture, deal locking, Stripe secret key usage) live exclusively in /functions and are never exposed to the client.

### Database: Firestore (NoSQL)

#### Why Firestore?
- Real-time updates
- Flexible document-based schema
- Strong integration with Firebase ecosystem
- Built-in security rules

Database used to store:
- Users
- Groups
- Bulk orders
- Order items
- Membership relationships

### Authentication: Firebase Auth
Handles:
- User registration
- Login
- Token issuance
- Secure identity verification

Authentication tokens are validated in Cloud Functions to prevent unauthorized actions.

### Payments: Stripe API (Server-Side Only)
Stripe integration is handled entirely in Cloud Functions:
- Secret keys are never exposed to the client
- Payment intents are created server-side
- Clients only receive safe payment responses

This mirrors real production payment architecture.

## Architecture Overview
Batch uses a monorepo structure where the Expo app serves as the frontend and Firebase Cloud Functions serve as the backend. While both live in the same repository, they are deployed and executed independently.

### Monorepo Structure
```
batch/
├── src/              # Expo frontend application
├── functions/        # Firebase Cloud Functions backend
├── firestore.rules   # Firestore security rules
├── firebase.json     # Firebase deployment configuration
```

## System Architecture Diagram
Brief text-based overview (flows from top-down):
```
Expo App (Client)
        |
Reads/Writes Firestore (Database)
        |
Triggers Cloud Functions (Server)
        |
Calls Stripe API (Payments)
```

### Flow Explanation
1. User interacts with Expo app
2. App reads/writes non-sensitive data to Firestone
3. Sensitivie actions trigger HTTPS Cloud Functions
4. Cloud Functions:
- Validate authentication tokens
- Perform business logic
- Interact with Stripe
- Update Firestone securely

## File Structure
```
/src
```
Frontend React Native app.
- app/ -> Routes and screens
- components/ -> Reusable UI components
- services/firebase.ts -> Firebase configuration
- hooks/ -> Custom React hooks
- types/ -> TypeScript interfaces
- constants/ -> Static configuration

```
/functions
```
Backend logic.
- index.js -> Cloud Function entry point
- Handles:
- - Payment processing
- - Deal locking
- - Sensitive validation
- - Server-side business rules

## Key Features
- User authentication
- Group creation and joining
- Tiered pricing logic
- Automatic deal locking
- Secure payment handling
- Server-side validation
- Firestore security rules enforcement

## Security Considerations
- Firestore rules restrict unauthorized reads/writes
- All secret keys stored in environment variables
- Payment processing handled server-side only
- Authentication tokens verified before sensitive actions
- No sensitive logic executed on client

## Learning Goals
- Full-stack request lifecycle
- Serverless backend architecture
- Designing NoSQL schemas
- Security rule enforcement
- Handling asynchronous operations
- Separating client vs server responsibilities
- Managing environment variables safely

## Live Demo / Deployment Goal
One of the main goals for Batch is to provide a **clickable, fully hosted version** of the app that anyone can try without installing anything locally.

Currently, the app is configured to run as a **web application via Expo** and will be deployed to **Firebase Hosting**, providing a permanent, publicly accessible URL.

This deployment demonstrates:
- Frontend + backend integration
- Serverless architecture with Cloud Functions
- Proper authentication and security in a deployed environment
- Real-world project delivery, similar to professional software development

Once deployed, a test account will be provided so reviewers can:
- Sign in
- Create and join group orders
- Experience pricing and order logic
- See secure payment flow simulation