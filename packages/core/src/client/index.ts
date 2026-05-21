"use client";

/**
 * Client subpath barrel. Consumers normally import from the package root
 * (`click-to-edit`), but exposing this file lets the root re-export from a
 * single place.
 */

export { ClickToEditProvider } from "./provider.js";
