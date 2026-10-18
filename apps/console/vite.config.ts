import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { navigationGuard } from "./src/server/navigationGuard";
import { sessionGateway } from "./src/server/sessionGateway";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), [
    "VITE_",
    "CORTEX_API_TARGET",
    "CORTEX_BROWSER_GATEWAY_TARGET",
  ]);
  const auth = env.VITE_AUTH_MODE || "manual";
  if (
    (env.VITE_LOCAL_ACCESS && !["0", "1"].includes(env.VITE_LOCAL_ACCESS)) ||
    (env.VITE_LOCAL_ACCESS === "1" &&
      (auth !== "session" ||
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(
          env.VITE_LOCAL_DOMAIN ?? "",
        )))
  )
    throw new Error(
      "Local access requires session mode and an explicit domain UUID",
    );
  if (
    !["manual", "session"].includes(auth) ||
    (auth === "session" && env.VITE_DATA_MODE !== "api")
  )
    throw new Error(
      "VITE_AUTH_MODE requires manual, or session with VITE_DATA_MODE=api",
    );
  return {
    plugins: [
      navigationGuard(),
      ...(auth === "session"
        ? [sessionGateway(env.CORTEX_BROWSER_GATEWAY_TARGET)]
        : []),
    ],
    server: {
      port: 5173,
      strictPort: true,
      fs: {
        // Retain Vite's defaults and exclude private ingestion/runtime artifacts.
        deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.runtime/**"],
      },
      proxy:
        auth === "session"
          ? undefined
          : {
              "/api": {
                target: env.CORTEX_API_TARGET || "http://127.0.0.1:8000",
                rewrite: (path) => path.replace(/^\/api/, ""),
              },
            },
    },
    test: {
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      environment: "jsdom",
    },
  };
});
