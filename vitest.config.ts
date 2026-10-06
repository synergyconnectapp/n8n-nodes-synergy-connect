import { defineConfig } from 'vitest/config';

export default defineConfig({
	// OPENAPI_FILE and OPENAPI_URL reach test/contract.test.ts (vitest only shows a test the variables with these prefixes)
	envPrefix: ['VITE_', 'OPENAPI_'],
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
	},
});
