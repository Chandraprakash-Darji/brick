import { app } from "./app";

app.listen(Number(process.env.PORT ?? 3001));
console.log(`Comments extension listening on http://localhost:${app.server!.port}`);
