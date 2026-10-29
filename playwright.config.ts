import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
  testDir: './tests/e2e', workers: 1, retries: 0, timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:4183', viewport: {width:1440,height:1000}, screenshot:'only-on-failure', trace:'retain-on-failure' },
  reporter: [['list']],
  webServer: { command: 'pnpm dev', url: 'http://127.0.0.1:4183', timeout:30000, reuseExistingServer:false,
    env: { KNOWGST_WEB_PORT:'4183', KNOWGST_RUNTIME:resolve(`.local/e2e-${Date.now()}`) },
  },
});
