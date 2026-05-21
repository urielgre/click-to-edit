/**
 * Generates the contents of the dev edit route file. Single, stable string —
 * we keep it here (rather than reading a template asset) so the bundled CLI
 * is self-contained and doesn't need a `files` entry pointing at templates.
 */

const ROUTE_FILE_CONTENTS = `import { createEditHandler } from "click-to-edit/server";

export const POST = createEditHandler();

// Block other HTTP verbs explicitly so the route's behavior is unambiguous.
export const GET = () =>
  new Response("Method Not Allowed", { status: 405 });
`;

export function createRouteFileContents(): string {
  return ROUTE_FILE_CONTENTS;
}
