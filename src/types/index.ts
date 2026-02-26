export interface User {
  id: string
  displayName: string
  email: string
  avatarUrl?: string
}

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
  paymentIntentId: string
  status: 'held' | 'charged' | 'released'
}