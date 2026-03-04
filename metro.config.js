const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

// Teach Metro how to resolve the @/* path alias used throughout the project.
// Without this, Metro can't find @/services/firebase, @/types, etc. even though
// TypeScript knows about them via tsconfig paths.
config.resolver.alias = {
  '@': './src',
}

module.exports = config
