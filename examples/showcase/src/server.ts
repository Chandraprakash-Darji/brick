import { brick } from "@brickkit/cli";
import { usersService } from "./services/users";

const app = brick({ services: [usersService] });
app.listen(Number(process.env.PORT ?? 3000));
