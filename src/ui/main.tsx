import React from "react";
import "@react-spectrum/s2/page.css";
import "./page.css";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
