"use client";

import { useEffect } from "react";

// Registers public/sw.js. Kept in its own component so the root layout stays a
// server component.
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Registering during development would cache the dev bundle and confuse
    // every later reload.
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Blocked by the browser or unsupported: the app works, just not offline.
    });
  }, []);
  return null;
}
