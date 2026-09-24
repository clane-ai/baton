import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Stands in for the platform's Jest + RTL: specs use only describe/it/expect globals and
// @testing-library/react, so they run under either runner.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    include: ["clane-client/src/**/*.spec.{ts,tsx}"],
  },
});
