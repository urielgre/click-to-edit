"use client";

import type { EditRequest, EditResponse } from "../shared/types.js";

/**
 * POST an edit request to the dev route. Returns a uniform `EditResponse`
 * shape even on network failure, so the overlay never has to branch on
 * thrown errors vs. HTTP errors.
 */
export async function postEdit(
  route: string,
  request: EditRequest,
): Promise<EditResponse> {
  try {
    const res = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    // Try to parse the body as JSON regardless of status; the server contract
    // says it always returns JSON of shape EditResponse.
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return {
        ok: false,
        error: "write_failed",
        message: `Server returned ${res.status} with non-JSON body.`,
      };
    }

    // Trust the body if it matches the discriminator.
    if (
      body &&
      typeof body === "object" &&
      "ok" in (body as Record<string, unknown>)
    ) {
      return body as EditResponse;
    }

    return {
      ok: false,
      error: "write_failed",
      message: `Server returned unexpected payload (status ${res.status}).`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: "write_failed",
      message: `Network error: ${msg}`,
    };
  }
}
