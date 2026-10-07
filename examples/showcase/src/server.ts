import { createBrickServer } from "@elregaldo/cli";
import { usersService } from "./services/users";

const app = createBrickServer({ services: [usersService] });
app.listen(Number(process.env.PORT ?? 3000));
