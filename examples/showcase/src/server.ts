import { createBrickServer } from "@brickkit/cli";
import { usersService } from "./services/users";

const app = createBrickServer({ services: [usersService] });
app.listen(Number(process.env.PORT ?? 3000));
