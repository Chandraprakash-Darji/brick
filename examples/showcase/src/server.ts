import { brick } from "@brickkit/core";
import { usersService } from "./services/users";

const app = brick({ services: [usersService] });
app.listen(Number(process.env.PORT ?? 3000));
