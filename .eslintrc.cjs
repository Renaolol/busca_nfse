module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint'],
  extends: ['plugin:@typescript-eslint/recommended', 'prettier'],
  env: {
    node: true,
    jest: true
  },
  ignorePatterns: ['dist/', 'node_modules/', '.eslintrc.cjs'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off'
  }
};
