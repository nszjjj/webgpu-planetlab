import { defineConfig } from 'vite';

export default defineConfig({
  base: '/webgpu-planetlab/',
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
  },
});
