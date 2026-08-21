import { buildApp } from "./app";
import { env } from "./env";
import { startJobScheduler, stopJobScheduler } from "./jobs/queue";

const app = buildApp();

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then(async () => {
    app.log.info(`Courier API listening on :${env.PORT} (${env.NODE_ENV})`);
    await startJobScheduler();
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await stopJobScheduler();
    await app.close();
    process.exit(0);
  });
}
