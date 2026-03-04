// Renders a single deal card in the feed list.
//
// Kept as its own component because the card is the natural home for the Join button
// and buyer-progress display — putting that logic here keeps index.tsx focused on
// the list itself rather than individual card behaviour.
//
// onPress is provided by the parent and navigates to the deal detail screen.
// The Join button will also live here once the detail screen exists.

import { Text, TouchableOpacity, StyleSheet } from 'react-native'
import type { Deal } from '@/types'

interface Props {
  deal: Deal
  onPress: () => void
}

export default function DealCard({ deal, onPress }: Props) {
  return (
    // TouchableOpacity rather than View so the whole card is tappable — tapping anywhere
    // on the card will navigate to the detail screen, which is the standard mobile pattern
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>

      <Text style={styles.title}>{deal.title}</Text>

      <Text style={styles.meta}>
        ${deal.pricePerPerson}/person · {deal.currentBuyers}/{deal.minBuyers} joined
      </Text>

      <Text style={styles.meta}>
        Closes {deal.deadline.toLocaleDateString()}
      </Text>

      {/* Join button goes here once the deal detail screen is built */}

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
