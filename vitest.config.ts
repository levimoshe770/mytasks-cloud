import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // localStorage and Response are both used by the store; happy-dom supplies
    // them without pulling in all of jsdom.
    environment: 'happy-dom',
    restoreMocks: true,
    unstubGlobals: true,
  },
});
