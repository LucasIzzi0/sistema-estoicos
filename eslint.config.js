import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/generated/**',
      '**/next-env.d.ts',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // La web nunca toca la base, la lógica del servidor ni secretos (ver docs/fase-0/03).
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@estoicos/db', '@estoicos/core', '@estoicos/integrations', '@estoicos/queue'],
              message: 'La web solo puede importar @estoicos/shared: todo lo demás pasa por la API.',
            },
          ],
        },
      ],
    },
  },
  {
    // Los paquetes compartidos no dependen de las apps ni el core de integraciones hacia arriba.
    files: ['packages/shared/**/*.ts', 'packages/integrations/**/*.ts', 'packages/queue/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@estoicos/db', '@estoicos/core'],
              message: 'Este paquete no puede depender de la base ni del core.',
            },
          ],
        },
      ],
    },
  },
);
