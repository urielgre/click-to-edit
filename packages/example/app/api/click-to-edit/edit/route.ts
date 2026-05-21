import { createEditHandler } from "click-to-edit/server";

export const POST = createEditHandler();

// Block any other HTTP verb explicitly so the route's behavior is unambiguous.
export const GET = () =>
  new Response("Method Not Allowed", { status: 405 });
