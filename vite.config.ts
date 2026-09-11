import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // The direct Cloudflare deployment owns its bindings and private Access gate.
  // Retain the registered Sites manifest for the existing deployment's provenance.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    environments: {
      ssr: {
        optimizeDeps: {
          include: ['lucide-react', '@base-ui/react/dialog', '@base-ui/react/select', '@base-ui/react/button'],
        },
      },
    },
    server: {
      // Vite 8.0.13 can recursively forward its own WebSocket failures after
      // a server disconnect. Keep errors in the browser console/overlay.
      forwardConsole: false,
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      // The previous Sites deployment is preserved; this build targets the user's account.
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        configPath: './wrangler.jsonc',
      }),
    ],
  };
});
