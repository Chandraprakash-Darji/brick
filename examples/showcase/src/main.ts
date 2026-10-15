import { getUser } from "./services/users";

const user = await getUser({ input: { id: "usr_42" } });
console.log(user);
