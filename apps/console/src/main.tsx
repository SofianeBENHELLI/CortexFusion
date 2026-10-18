import React, { lazy } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { PendingWorkBoundary } from "./api/PendingWorkBoundary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "./theme";
import { AsyncWorkspace } from "./AsyncWorkspace";
import { BrandName } from "./BrandName";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "./styles.css";

// Build-time branches keep the local demo and its storage out of the API bundle.
const Application =
  import.meta.env.VITE_DATA_MODE === "api"
    ? import.meta.env.VITE_AUTH_MODE === "session"
      ? lazy(() =>
          import("./api/BrowserConnection").then((m) => ({
            default: m.BrowserConnection,
          })),
        )
      : !import.meta.env.VITE_AUTH_MODE ||
          import.meta.env.VITE_AUTH_MODE === "manual"
        ? lazy(() =>
            import("./api/ApiConnection").then((m) => ({
              default: m.ApiConnection,
            })),
          )
        : null
    : !import.meta.env.VITE_DATA_MODE ||
        import.meta.env.VITE_DATA_MODE === "mock"
      ? lazy(() => import("./MockApp"))
      : null;
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 0 } },
});

const router = createBrowserRouter([
  {
    path: "*",
    element: (
      <PendingWorkBoundary>
        <AsyncWorkspace name={<BrandName />} resetKey="application">
          {Application ? (
            <Application />
          ) : (
            <p role="alert">
              Configuration invalide : VITE_DATA_MODE doit être mock ou api ;
              VITE_AUTH_MODE doit être manual ou session.
            </p>
          )}
        </AsyncWorkspace>
      </PendingWorkBoundary>
    ),
  },
]);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
