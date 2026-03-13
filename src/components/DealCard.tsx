// Renders a single deal card used in the feed, My Deals, and anywhere deals are listed.
//
// Kept as its own component so list screens (index.tsx, my-deals.tsx) stay focused on
// data fetching and layout rather than card-level rendering.
//
// onPress is provided by the parent and navigates to the deal detail screen.

import { Text, TouchableOpacity, StyleSheet } from 'react-native'
import type { Deal } from '@/types'

interface Props {
  deal: Deal
  onPress: () => void
}

export default function DealCard({ deal, onPress }: Props) {
  return (
    // TouchableOpacity rather than View so the whole card is tappable, tapping anywhere
    // on the card will navigate to the detail screen, which is the standard mobile pattern
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>

      <Text style={styles.title}>{deal.title}</Text>

      <Text style={styles.meta}>
        ${deal.pricePerPerson}/person · {deal.currentBuyers}/{deal.minBuyers} joined
      </Text>

      <Text style={styles.meta}>
        Closes {deal.deadline.toLocaleDateString()}
      </Text>

    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  meta: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
})
