import js from '@eslint/js'

export default [
  { ignores: ['node_modules/', '.wrangler/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // Cloudflare Workers runtime, plus what the tests use.
      globals: { fetch: 'readonly', Response: 'readonly', URL: 'readonly', crypto: 'readonly', console: 'readonly' },
    },
  },
]
