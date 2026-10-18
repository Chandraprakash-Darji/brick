/** A stand-in for a shipping carrier's API that can be made to fail. */
export interface Carrier {
  book(orderId: string): Promise<string>;
  /** Fail the next `count` bookings. */
  failNext(count: number): void;
  readonly bookings: readonly string[];
}

export function createCarrier(options: { failures?: number } = {}): Carrier {
  let failures = options.failures ?? 0;
  const bookings: string[] = [];
  return {
    bookings,
    failNext(count) {
      failures = count;
    },
    async book(orderId) {
      if (failures > 0) {
        failures--;
        throw new Error("carrier unavailable");
      }
      bookings.push(orderId);
      return `trk_${orderId.slice(0, 8)}`;
    },
  };
}
