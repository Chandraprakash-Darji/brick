import { createEventsApp } from "./events-factory";

const made = createEventsApp("events_dev_service");
export const received = made.received;
export const seedPending = made.seedPending;
export default made.app;
