import { getWritable } from "workflow";

async function writeChunks(count: number): Promise<void> {
  "use step";
  const writer = getWritable<string>().getWriter();
  try {
    for (let i = 0; i < count; i++) {
      await writer.write(`chunk-${String(i).padStart(4, "0")}\n`);
    }
  } finally {
    writer.releaseLock();
  }
}

async function closeStream(): Promise<void> {
  "use step";
  await getWritable<string>().close();
}

/**
 * Scenario 7: one step writes `count` chunks to the run's default stream, then
 * (unless told not to) another step closes it, as the streaming docs advise
 * ("Close streams when done").
 */
export async function streamChunks(count: number, close = true) {
  "use workflow";
  await writeChunks(count);
  if (close) await closeStream();
  return count;
}
