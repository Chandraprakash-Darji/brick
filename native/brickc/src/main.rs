use clap::{Parser, Subcommand};
use std::io::Read;
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "brickc",
    version,
    about = "Brick backend compiler and plan validator"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Emit versioned JSON execution plans for the Bun runtime
    Compile { path: PathBuf },
    /// Validate manifest and run compiler pipeline
    Check {
        /// Path to brick.manifest.json (or '-' for stdin)
        path: PathBuf,
    },
    /// Dump the lowered HIR representation
    DumpHir {
        /// Path to brick.manifest.json (or '-' for stdin)
        path: PathBuf,
    },
    /// Dump all resolved HTTP routes
    DumpRoutes {
        /// Path to brick.manifest.json (or '-' for stdin)
        path: PathBuf,
    },
    /// Dump compiled resource plans and generated SQL queries
    DumpPlan {
        /// Path to brick.manifest.json (or '-' for stdin)
        path: PathBuf,
    },
}

fn read_input(path: &PathBuf) -> Result<String, std::io::Error> {
    if path.to_str() == Some("-") {
        let mut buffer = String::new();
        std::io::stdin().read_to_string(&mut buffer)?;
        Ok(buffer)
    } else {
        std::fs::read_to_string(path)
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Compile { path } => {
            let content = read_input(&path)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&brickc::compile_runtime_json(&content)?)?
            );
        }
        Commands::Check { path } => {
            let content = read_input(&path)?;
            let artifacts = brickc::compile_json(&content)?;
            let summary = artifacts.summary();
            println!("Manifest is valid.");
            println!("Services:        {}", summary.service_count);
            println!("Resources:       {}", summary.resource_count);
            println!("Actions:         {}", summary.action_count);
            println!("Routes:          {}", summary.route_count);
            println!("Resource Plans:  {}", summary.resource_plan_count);
        }
        Commands::DumpHir { path } => {
            let content = read_input(&path)?;
            let artifacts = brickc::compile_json(&content)?;
            println!("{:#?}", artifacts.hir);
        }
        Commands::DumpRoutes { path } => {
            let content = read_input(&path)?;
            let artifacts = brickc::compile_json(&content)?;
            println!("ROUTES ({})", artifacts.router.routes.len());
            for route in &artifacts.router.routes {
                println!("  {:<6} {} -> {:?}", route.method, route.path, route.target);
            }
        }
        Commands::DumpPlan { path } => {
            let content = read_input(&path)?;
            let artifacts = brickc::compile_json(&content)?;
            println!("RESOURCE PLANS ({})", artifacts.resources.plans.len());
            for plan in &artifacts.resources.plans {
                println!(
                    "  Plan: {}.{} (PK: {}, Owner: {:?})",
                    plan.service_name,
                    plan.resource_name,
                    plan.primary_key_name,
                    plan.owner_field_name
                );
                for op in &plan.operations {
                    let limit = if op == "list" { Some(50) } else { None };
                    match artifacts.sql_for(&plan.service_name, &plan.resource_name, op, limit) {
                        Ok(sql) => println!("    {:<6} => {}", op, sql),
                        Err(_) => println!("    {:<6} => (non-query operation)", op),
                    }
                }
            }
        }
    }

    Ok(())
}

fn main() {
    if let Err(err) = run() {
        eprintln!("error: {err}");
        std::process::exit(1);
    }
}
