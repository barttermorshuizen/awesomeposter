import winston from 'winston';

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
function genCorrelationId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `cid_${Math.random().toString(36).slice(2)}`;
  }
}

export { genCorrelationId, getLogger };
//# sourceMappingURL=logger.mjs.map
