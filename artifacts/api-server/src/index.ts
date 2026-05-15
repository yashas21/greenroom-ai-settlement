import app from "./app";
import { logger } from "./lib/logger";
import { migrationsReady } from "./db";
import { backfillUpcomingGuarantees } from "./lib/smartGuarantee";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function runGuaranteeBackfill(label: string): Promise<void> {
  try {
    const result = await backfillUpcomingGuarantees();
    logger.info({ result }, `guarantee backfill (${label})`);
  } catch (err) {
    logger.error({ err }, `guarantee backfill failed (${label})`);
  }
}

migrationsReady
  .then(() => runGuaranteeBackfill("boot"))
  .catch((err) => logger.error({ err }, "migrationsReady failed"));

setInterval(() => {
  void runGuaranteeBackfill("nightly");
}, ONE_DAY_MS).unref();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
