export function parsePort(
  portStr: string | undefined,
  envPort?: string | undefined,
): number {
  const cliPort = portStr;
  const fallbackPort = envPort ? Number(envPort) : undefined;
  const port = cliPort !== undefined ? Number(cliPort) : fallbackPort || 4000;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid port: ${port}. Port must be an integer between 1 and 65535`,
    );
  }
  return port;
}
