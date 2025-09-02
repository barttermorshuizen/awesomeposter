import winston from 'winston'

let logger: winston.Logger | null = null

export function getLogger() {
  if (logger) return logger

  const level = process.env.LOG_LEVEL || 'info'
  const isProd = process.env.NODE_ENV === 'production'

  const baseFormat = isProd
    ? winston.format.json()
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''
          return `${timestamp} ${level}: ${message}${metaStr}`
        })
      )

  logger = winston.createLogger({
    level,
    defaultMeta: { service: 'agents-server' },
    transports: [new winston.transports.Console({ format: baseFormat })]
  })

  return logger
}

export function genCorrelationId() {
  try {
    return crypto.randomUUID()
  } catch {
    return `cid_${Math.random().toString(36).slice(2)}`
  }
}

