import { defineConfig } from "vitest/config";

// Tests cover the pure modules only and run in plain Node (no workerd).
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
