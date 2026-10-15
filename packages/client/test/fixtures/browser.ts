import { api } from "./contract";
import { createClient } from "../../src";
export const connect = (baseUrl: string) => createClient(api, { baseUrl });
