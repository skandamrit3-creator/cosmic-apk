// Compatibility entry point for legacy tooling that still checks frontend/js/app.js.
// The active application entry point remains frontend/js/foundation/app.js (loaded by index.html).
// Dynamic import keeps this shim valid under Node's CommonJS syntax-check mode.
import("./foundation/app.js").catch(error => {
  console.error("COSMIC application entry point failed to load:", error);
});
