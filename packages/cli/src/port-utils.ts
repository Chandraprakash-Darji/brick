export function parsePort(
  portStr: string | undefined,
  envPort?: string | undefined,
): number {
  let port: number | undefined;
  if (portStr !== undefined) {
    port = Number(portStr);
  } else if (envPort !== undefined && envPort !== "") {
    port = Number(envPort);
  } else {
    port = 4000;
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid port: ${port}. Port must be an integer between 1 and 65535`,
    );
  }
  return port;
}

/** The dev port: CLI flag, then PORT, then the config file, then 4000. */
export function resolveDevPort(
  cliPort: number | undefined,
  configPort?: number,
  envPort = process.env.PORT,
): number {
  if (cliPort !== undefined) return cliPort;
  if (configPort !== undefined && !envPort) return configPort;
  return parsePort(undefined, envPort);
}
