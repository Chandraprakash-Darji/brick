import type { Service } from "@elregaldo/core";
import { createActionHandler } from "./action-handler";
import type { EndpointMethod } from "./endpoints";

/** Both HTTP adapters mount the same action aliases and resource routes. */
export function mountActionRoutes(services: Service<any, any>[], prefix: string, mountRoute: (method: EndpointMethod, path: string, handler: any) => void) {
  // Mount services
  for (const service of services) {
    // 2. Mount Service Resources REST endpoints
    if (typeof (service as any).listResources === "function") {
      for (const resource of (service as any).listResources()) {
        const resourceCollectionPath = `${prefix}/${resource.name}`;
        const resourceItemPath = `${prefix}/${resource.name}/:id`;

        if (resource.actions.list) {
          mountRoute("GET", resourceCollectionPath, createActionHandler(service, resource.actions.list, resourceCollectionPath, "GET"));
        }
        if (resource.actions.create) {
          mountRoute("POST", resourceCollectionPath, createActionHandler(service, resource.actions.create, resourceCollectionPath, "POST"));
        }
        if (resource.actions.get) {
          mountRoute("GET", resourceItemPath, createActionHandler(service, resource.actions.get, resourceItemPath, "GET"));
        }
        if (resource.actions.update) {
          mountRoute("PATCH", resourceItemPath, createActionHandler(service, resource.actions.update, resourceItemPath, "PATCH"));
          mountRoute("PUT", resourceItemPath, createActionHandler(service, resource.actions.update, resourceItemPath, "PUT"));
        }
        if (resource.actions.delete) {
          mountRoute("DELETE", resourceItemPath, createActionHandler(service, resource.actions.delete, resourceItemPath, "DELETE"));
        }
      }
    }

    // 3. Mount Service Actions and Custom Action Paths
    for (const action of service.listActions()) {
      const actionPath = `${prefix}/${service.name}/${action.name}`;
      const postHandler = createActionHandler(service, action, actionPath, "POST");

      // Mount default POST action endpoint
      mountRoute("POST", actionPath, postHandler);

      // Mount default GET for read-like actions
      if (
        action.name.startsWith("get") ||
        action.name.startsWith("list") ||
        action.name.startsWith("find") ||
        action.name.startsWith("read")
      ) {
        const getHandler = createActionHandler(service, action, actionPath, "GET");
        mountRoute("GET", actionPath, getHandler);
      }

      // If action defines custom path (e.g. path: "/api/public/pages/:slug")
      if (action.config?.path) {
        const customPath = action.config.path;
        const customMethod = action.config.method;

        if (customMethod) {
          mountRoute(customMethod, customPath, createActionHandler(service, action, customPath, customMethod));
        } else {
          // If no method specified, mount both GET and POST for custom path
          mountRoute("GET", customPath, createActionHandler(service, action, customPath, "GET"));
          mountRoute("POST", customPath, createActionHandler(service, action, customPath, "POST"));
        }
      }
    }
  }

}
