import { createAuthInstance } from "./index";
import { makeAuthDatabase } from "../db";
import { databaseUrlSecret } from "../secrets";
export const auth = createAuthInstance(
  makeAuthDatabase(databaseUrlSecret.require()).db,
);
