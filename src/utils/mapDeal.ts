// Converts a raw Firestore deal document into a typed Deal object.
//
// Firestore stores dates as Timestamps, not JS Dates. This function normalises
// the deadline field so the rest of the app can treat it as a plain Date without
// worrying about Firestore internals. Centralised here because the same mapping
// was duplicated in index.tsx, my-deals.tsx, and deal/[id].tsx.

import type { DocumentSnapshot } from 'firebase/firestore'
import type { Deal } from '@/types'

export function mapDeal(doc: DocumentSnapshot): Deal {
  const data = doc.data()!
  return {
    ...data,
    id: doc.id,
    // Firestore Timestamps have a toDate() method; fall back to now if missing
    deadline: data.deadline?.toDate() ?? new Date(),
  } as Deal
}
