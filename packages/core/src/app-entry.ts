import type { BrickApp } from "./endpoints";

/**
 * Whether a value is an application made by `brick()`. It checks for the
 * methods and `definition` a `BrickApp` has, so it also recognizes one built by
 * another copy of the package.
 *
 * @param app - Anything, such as the default export of an entry file.
 * @returns `true` for a `BrickApp`, narrowing its type.
 */
export function isBrickApp(app: unknown): app is BrickApp {
  if (!app || typeof app !== "object") return false;
  return (
    "endpoint" in app &&
    typeof app.endpoint === "function" &&
    "fetch" in app &&
    typeof app.fetch === "function" &&
    "listen" in app &&
    typeof app.listen === "function" &&
    "definition" in app &&
    !!app.definition &&
    typeof app.definition === "object" &&
    "services" in app.definition &&
    Array.isArray(app.definition.services) &&
    "prefix" in app.definition &&
    typeof app.definition.prefix === "string"
  );
}

/**
 * Check that a module's default export is an application ready to be served,
 * for tools that load an entry file.
 *
 * @param app - The default export of an entry file.
 * @returns The app.
 * @throws When it is not a `BrickApp`, or it already called `.listen()`: the
 * entry must only build the app, and leave listening to the server bootstrap.
 */
export function requireBrickApp(app: unknown): BrickApp {
  if (!isBrickApp(app))
    throw new Error(
      "Brick: the entry module must default-export a BrickApp created by brick().",
    );
  if (app.server)
    throw new Error(
      "Brick: the app entry must not call .listen(); use a separate server bootstrap.",
    );
  return app;
}
