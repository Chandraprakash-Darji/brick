use clap::Parser;
#[derive(Parser)]
struct Args {
    #[arg(long)]
    plans: String,
    /// JSON map from service name to file-backed SQLite path
    #[arg(long)]
    databases: String,
    #[arg(long)]
    upstream: String,
    /// Immutable registry snapshot; served directly without calling the worker
    #[arg(long)]
    architecture: String,
    /// Startup snapshot of OpenAPI/documentation responses
    #[arg(long)]
    documents: Option<String>,
    #[arg(long, default_value = "127.0.0.1:4000")]
    listen: String,
    #[arg(long, default_value = "/api")]
    prefix: String,
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let args = Args::parse();
    let router = brick_http::server::build_router(
        brick_http::server::ServerConfig {
            plans: std::fs::read_to_string(args.plans)?,
            databases: std::fs::read_to_string(args.databases)?,
            architecture: std::fs::read_to_string(args.architecture)?,
            documents: args.documents.map(std::fs::read_to_string).transpose()?,
            upstream: Some(args.upstream),
            prefix: args.prefix,
            bindings: Vec::new(),
        },
        None,
    )?;
    let listener = tokio::net::TcpListener::bind(&args.listen).await?;
    println!("Brick native HTTP listening on {}", listener.local_addr()?);
    axum::serve(listener, router).await?;
    Ok(())
}
