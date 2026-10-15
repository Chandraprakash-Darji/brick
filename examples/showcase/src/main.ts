import { Effect } from "effect";
import { getUser } from "./services/users";

const user = await Effect.runPromise(getUser.handler({ id: "usr_42" }));
console.log(user);
