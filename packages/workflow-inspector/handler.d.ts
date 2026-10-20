export interface InspectorHandlerOptions {
  /** Mount path the inspector is served under (e.g. `"/workflows"`). Default: `"/"`. */
  basename?: string;
  /** The Workflow SDK world to read runs, steps, events and hooks from. */
  world: object;
  /** The manifest the Graph view draws; omit when there is none. */
  manifestPath?: string;
}

/**
 * A Web `Request` -> `Response` handler for the Workflow inspector, to mount in
 * another server under `basename`. Throws when the package has not been built.
 * A process has one inspector: a second call replaces the first one's world.
 */
export function createInspectorHandler(
  options: InspectorHandlerOptions,
): Promise<(request: Request) => Promise<Response>>;
