import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  ignores: ['.nuxt/**', '.output/**', '.data/**', '.nitro/**', '.cache/**', 'dist/**', 'node_modules/**', '.yarn/**'],
})
