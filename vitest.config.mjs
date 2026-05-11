import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        testTimeout: 30000, // 30 seconds (default is 5000ms)
    },
    resolve: {
        alias: {
            // Mock obsidian package for testing
            obsidian: new URL("./tests/__mocks__/obsidian.ts", import.meta.url).pathname,
        },
    },
    define: {
        global: "globalThis",
    },
});
