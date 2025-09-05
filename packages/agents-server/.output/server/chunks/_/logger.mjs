globalThis.__timing__.logStart('Load chunks/_/logger');import winston from 'winston';

let logger = null;
function getLogger() {
  if (logger) return logger;
  const level = process.env.LOG_LEVEL || "info";
  const baseFormat = winston.format.json() ;
  logger = winston.createLogger({
    level,
    defaultMeta: { service: "agents-server" },
    transports: [new winston.transports.Console({ format: baseFormat })]
  });
  return logger;
}

export { getLogger };;globalThis.__timing__.logEnd('Load chunks/_/logger');
//# sourceMappingURL=logger.mjs.map
