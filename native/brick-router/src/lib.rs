use brick_hir::types::{ActionId, Hir, ResourceId, ServiceId};

use crate::RouterError::{DuplicateRoute, InvalidOperationType, UnknownService};

#[derive(Clone, Debug)]
pub enum RouteTarget {
    Resource {
        service: ServiceId,
        resource: ResourceId,
        operation: String,
    },
    Action {
        service: ServiceId,
        action: ActionId,
    },
}

#[derive(Clone, Debug)]
pub struct Route {
    pub method: String,
    pub path: String,
    pub target: RouteTarget,
}

pub struct Router {
    pub routes: Vec<Route>,
}

#[derive(Debug, thiserror::Error)]
pub enum RouterError {
    #[error("duplicate route {0}")]
    DuplicateRoute(String),
    #[error("invalid operation type {0}")]
    InvalidOperationType(String),
    #[error("unknown {0} {1}")]
    UnknownService(String, String),
}

pub fn build(hir: &Hir) -> Result<Router, RouterError> {
    let mut router: Router = Router { routes: Vec::new() };

    for resource in &hir.resources {
        process_operations(
            &mut router.routes,
            &hir,
            &resource.service,
            &resource.id,
            resource.operations.clone(),
        )?;
    }
    process_actions(&mut router.routes, &hir)?;

    Ok(router)
}

impl Router {
    pub fn resolve(&self, method: &str, path: &str) -> Option<&Route> {
        get_route(&self.routes, path.to_string(), method.to_string())
    }
}

fn process_actions(routes: &mut Vec<Route>, hir: &Hir) -> Result<(), RouterError> {
    for action in &hir.actions {
        let service = hir.services.iter().find(|s| s.id == action.service).ok_or(
            RouterError::UnknownService("Service".to_string(), action.service.0.to_string()),
        )?;
        let service_id = service.id;
        let service_name = service.name.clone();

        let action_name = action.name.clone();

        let path = format!("/{service_name}/{action_name}");

        let route = get_route(routes, path.to_string(), "POST".to_string());

        if route.is_some() {
            return Err(DuplicateRoute(path));
        } else {
            routes.push(Route {
                method: "POST".to_string(),
                path: path.to_string(),
                target: RouteTarget::Action {
                    action: action.id,
                    service: service_id,
                },
            });
        }
    }
    Ok(())
}

fn process_operations(
    routes: &mut Vec<Route>,
    hir: &Hir,
    service_id: &ServiceId,
    resource_id: &ResourceId,
    operations: Vec<String>,
) -> Result<(), RouterError> {
    for operation in operations {
        let service_name = &hir
            .services
            .iter()
            .find(|s| s.id == *service_id)
            .ok_or(UnknownService(
                "Service".to_string(),
                service_id.0.to_string(),
            ))?
            .name
            .clone();

        let resource_name = &hir
            .resources
            .iter()
            .find(|r| r.id == *resource_id)
            .ok_or(UnknownService(
                "Resource".to_string(),
                resource_id.0.to_string(),
            ))?
            .name
            .clone();

        let path = format!("/{service_name}/{resource_name}/{operation}");

        let method = match operation.as_str() {
            "list" | "get" => "GET",
            "create" => "POST",
            "delete" => "DELETE",
            "update" => "PATCH",
            _ => return Err(InvalidOperationType(operation.to_string())),
        };

        let route = get_route(routes, path.to_string(), method.to_string());

        if route.is_some() {
            return Err(DuplicateRoute(path));
        } else {
            routes.push(Route {
                method: method.to_string(),
                path: path.to_string(),
                target: RouteTarget::Resource {
                    service: *service_id,
                    resource: *resource_id,
                    operation: operation.to_string(),
                },
            });
        }
    }
    Ok(())
}

fn get_route(routes: &[Route], route: String, method: String) -> Option<&Route> {
    // returns thr route if exist, so we can throw error
    routes
        .iter()
        .find(|&r| r.path == route && r.method == method)
}
