// Note: Firebase Auth provides its own User type (import { User } from 'firebase/auth').
// No custom User interface is needed here — use Firebase's directly.

export interface Deal {
  id: string
  organizerId: string
  title: string
  pricePerPerson: number
  minBuyers: number
  maxBuyers?: number
  currentBuyers: number
  deadline: Date
  status: 'open' | 'locked' | 'expired'
}

export interface Commitment {
  id: string
  dealId: string
  userId: string
  joinedAt: Date
  paymentIntentId?: string  // set by Cloud Function once Stripe is integrated
  status: 'pending' | 'held' | 'charged' | 'released'
  // 'pending' = joined but no payment yet (pre-Stripe phase)
  // 'held'    = Stripe payment authorised but not captured
  // 'charged' = deal locked and payment captured
  // 'released'= deal fell through and auth was cancelled
}