import "@fontsource-variable/schibsted-grotesk";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./tokens.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
