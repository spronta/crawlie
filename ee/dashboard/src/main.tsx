import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@ui/styles/tokens.css";
import "@ui/styles/app.css";
import "./app-extra.css";
import { App } from "./App";
import { initTheme } from "@ui/lib/theme";

initTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
