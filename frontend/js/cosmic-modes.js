// Compatibility entry point for legacy tooling that still checks frontend/js/cosmic-modes.js.
// Mode navigation is now owned by frontend/js/foundation/app.js and the shared workspace router.
// Keep this shim parseable for older launchers without creating a second mode controller.
import("./foundation/app.js").catch(error => {
  console.error("COSMIC workspace router failed to load:", error);
});
