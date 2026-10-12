import { createApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { scalarReaderConfigured } from "./providers/document-extraction/scalar-reader.js";

const server = createApp().listen(config.PORT);

server.once("listening", () => {
  // A reader that is off or failing is silent to the user by design, so the log says which.
  logger.info({ port: config.PORT, scalarReader: scalarReaderConfigured() }, "api listening");
});

// Without this, a port clash surfaces as an unhandled 'error' event and a raw stack
// trace. A leftover dev server is the usual cause, so say so.
server.once("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error(
      { port: config.PORT },
      "port already in use — another server is still running; stop it or set PORT",
    );
  } else {
    logger.error({ err }, "server failed to start");
  }
  process.exit(1);
});
