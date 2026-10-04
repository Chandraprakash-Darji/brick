import { executeCompiledRoute, getActionHandlerPlan } from "./action-handler";
import { supportsNativeSchema, type BridgeRequest, type BridgeResponse } from "./bridge-types";
import { generateOpenApiSpec, getGlobalRegistry, resolveSecrets, isNativeResourceAction } from "@elregaldo/core";
import { mountActionRoutes } from "./action-routes";
import { createEndpointHandler, endpointPaths, type EndpointDefinition, type EndpointMethod } from "./endpoints";
import { scalarDocsHTML, swaggerDocsHTML } from "./docs-html";
import { installPlans } from "./plans";
import type { CreateServerOptions } from "./server";

/** Private execution worker: no public diagnostics and no Elysia dependency. */
export function createNativeWorker(options: CreateServerOptions = {}) {
  const services = options.services ?? getGlobalRegistry().list();
  const prefix = options.prefix ?? "/api";
  if (options.secrets?.validate !== false) resolveSecrets({ source: options.secrets?.source });
  for (const service of services) service.build();
  if (options.plans) installPlans(options.plans, services);

  const routes: Record<string, Partial<Record<EndpointMethod, (request: Bun.BunRequest) => Promise<Response>>>> = {};
  const endpoints: EndpointDefinition[] = [];
  const bindings: any[] = [];
  const invocations: ((request: BridgeRequest) => Promise<BridgeResponse>)[] = [];
  const mount = (method: EndpointMethod, path: string, handler: (context: any) => unknown) => {
    const methods = routes[path] ??= {};
    if (methods[method]) return;
    const plan = getActionHandlerPlan(handler);
    const nativeValidation = !!plan && !isNativeResourceAction(plan.action) &&
      supportsNativeSchema(plan.action.config.input) && supportsNativeSchema(plan.action.config.output);
    bindings.push({ id: bindings.length, method, path, actionName: plan?.actionName,
      hasInput: plan?.hasInput ?? false, isGetLike: plan?.isGetLike ?? false, nativeValidation,
      inputSchema: plan?.action.config.input, outputSchema: plan?.action.config.output });
    invocations.push(async data => {
      const headers = new Headers(data.headers.map(h => [h.name, h.value] as [string, string]));
      const request = new Request(data.url, { method: data.method, headers,
        body: data.body.length && !["GET", "HEAD"].includes(data.method) ? data.body as BodyInit : undefined });
      const set = { status: 200, headers: {} as Record<string, string> };
      let body: unknown;
      if (data.body.length && !data.inputValidated) {
        const contentType = headers.get("content-type")?.split(";", 1)[0]?.trim();
        if (contentType === "application/json") body = JSON.parse(Buffer.from(data.body).toString());
        else if (contentType === "application/x-www-form-urlencoded") body = Object.fromEntries(new URLSearchParams(Buffer.from(data.body).toString()));
        else if (contentType === "multipart/form-data") body = Object.fromEntries(await request.formData());
        else if (contentType?.startsWith("text/")) body = Buffer.from(data.body).toString();
      }
      const context = { request, params: JSON.parse(data.params), query: JSON.parse(data.query), body,
        headers: Object.fromEntries(headers), set };
      const result = plan ? await executeCompiledRoute(plan, context, {
        input: data.input === undefined ? undefined : JSON.parse(data.input),
        inputValidated: data.inputValidated, outputValidated: data.outputValidated,
      }) : await handler(context);
      let bytes: Uint8Array; let json = false;
      const responseHeaders = new Headers(set.headers);
      if (result instanceof Response) {
        set.status = result.status;
        for (const [name, value] of result.headers) if (name !== "set-cookie") responseHeaders.set(name, value);
        for (const cookie of result.headers.getSetCookie()) responseHeaders.append("set-cookie", cookie);
        for (const [name, value] of Object.entries(set.headers)) responseHeaders.set(name, value);
        bytes = await result.bytes();
      } else if (typeof result === "string" && !plan) {
        responseHeaders.set("content-type", "text/plain;charset=UTF-8"); bytes = Buffer.from(result);
      } else if (result === undefined) bytes = Buffer.alloc(0);
      else { json = true; responseHeaders.set("content-type", "application/json"); bytes = Buffer.from(JSON.stringify(result)); }
      return { status: set.status, headers: [...Array.from(responseHeaders, ([name, value]) => ({ name, value })).filter(h => h.name !== "set-cookie"),
        ...responseHeaders.getSetCookie().map(value => ({ name: "set-cookie", value }))], body: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), json };
    });
    methods[method] = async request => {
      const set = { status: 200, headers: {} as Record<string, string> };
      try {
        let body: unknown;
        if (request.body) {
          const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
          if (contentType === "application/json") body = await request.json();
          else if (contentType === "application/x-www-form-urlencoded") body = Object.fromEntries(new URLSearchParams(await request.text()));
          else if (contentType === "multipart/form-data") body = Object.fromEntries(await request.formData());
          else if (contentType?.startsWith("text/")) body = await request.text();
          // Leave unparsed raw/binary bodies available to endpoint handlers.
        }
        const result = await handler({ request, params: request.params, body,
          query: Object.fromEntries(new URL(request.url).searchParams),
          headers: Object.fromEntries(request.headers), set });
        if (result instanceof Response) {
          const headers = new Headers(result.headers);
          for (const [name, value] of Object.entries(set.headers)) headers.set(name, value);
          return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
        }
        if (typeof result === "string") return new Response(result, set);
        if (result === undefined) return new Response(null, set);
        return Response.json(result, set);
      } catch (error) {
        if (error instanceof SyntaxError) return Response.json({ name: "ParseError", message: "Invalid request body", status: 400 }, { status: 400 });
        return Response.json({ name: "InternalServerError", message: error instanceof Error ? error.message : "Unexpected error", status: 500 }, { status: 500 });
      }
    };
  };
  const endpoint = (def: EndpointDefinition) => {
    endpoints.push(def);
    mount(def.method, def.path, createEndpointHandler(def, services));
  };
  for (const def of options.endpoints ?? []) endpoint(def);
  mountActionRoutes(services, prefix, mount);

  // Framework documents are generated once; Rust serves their response bytes.
  const nativeDocuments = () => {
    const documents: Record<string, { contentType: string; body: string }> = {};
    const title = options.title ?? "Brick-TS API Mesh";
    const specPath = options.openApiPath ?? "/openapi.json";
    if (options.docs !== false) {
      const spec = generateOpenApiSpec({ title, version: options.version ?? "1.0.0", description: options.description, prefix, services });
      documents[specPath] = { contentType: "application/json", body: JSON.stringify({ ...spec, paths: { ...spec.paths, ...endpointPaths(endpoints) } }) };
      documents[options.docsPath ?? "/docs"] = { contentType: "text/html; charset=utf-8", body: scalarDocsHTML(specPath, title) };
      documents[options.swaggerPath ?? "/swagger"] = { contentType: "text/html; charset=utf-8", body: swaggerDocsHTML(specPath, title) };
    }
    if (options.reference) {
      const reference = options.reference === true ? {} : options.reference;
      documents[reference.path ?? "/reference"] = { contentType: "text/html; charset=utf-8", body: scalarDocsHTML(reference.specUrl ?? specPath, reference.title ?? title) };
    }
    return documents;
  };

  let server: Bun.Server<undefined> | undefined;
  let nativePort: number | undefined;
  const app = {
    get server() { return server ?? (nativePort === undefined ? undefined : { port: nativePort }); },
    attachNativePort(port: number | undefined) { nativePort = port; },
    nativeBindings: () => bindings,
    async dispatchBridge(data: BridgeRequest): Promise<BridgeResponse> {
      const invoke = invocations[data.bindingId];
      if (!invoke) throw new Error("Unknown native callback binding");
      try { return await invoke(data); }
      catch (error) {
        const status = error instanceof SyntaxError ? 400 : 500;
        return { status, headers: [{ name: "content-type", value: "application/json" }], json: true,
          body: Buffer.from(JSON.stringify({ name: status === 400 ? "ParseError" : "InternalServerError", message: error instanceof Error ? error.message : "Unexpected error", status })) };
      }
    },
    endpoint,
    nativeDocuments,
    listEndpoints: () => [...endpoints],
    listen(listen: number | { port: number; hostname?: string }) {
      if (server) throw new Error("Native worker is already listening");
      server = Bun.serve({ ...(typeof listen === "number" ? { port: listen } : listen), routes,
        fetch: () => new Response("NOT_FOUND", { status: 404 }) });
      return app;
    },
    async stop(closeActiveConnections = true) { await server?.stop(closeActiveConnections); return app; },
  };
  return app;
}

export type NativeWorker = ReturnType<typeof createNativeWorker>;
