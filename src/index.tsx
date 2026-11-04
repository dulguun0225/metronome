import { render } from "solid-js/web";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

render(() => <App />, root);

// Offline support when hosted; skipped on file://, where service workers are unavailable.
if (
  import.meta.env.PROD &&
  "serviceWorker" in navigator &&
  (location.protocol === "http:" || location.protocol === "https:")
) {
  const register = () => {
    navigator.serviceWorker.register("./sw.js").catch((error: unknown) => {
      console.warn("Service worker registration failed", error);
    });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
