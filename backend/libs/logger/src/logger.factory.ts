import winston from 'winston'

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'cyan',
  verbose: 'magenta',
}

winston.addColors(colors)

export function createLogger(serviceName: string) {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'debug',
    levels: winston.config.npm.levels,

    format: winston.format.combine(
      winston.format.colorize({ all: true }),
      winston.format.timestamp({
        format: 'MM/DD/YYYY, HH:mm:ss',
      }),
      winston.format.json(),
      winston.format.printf(({ timestamp, level, message }) => {
        const pid = process.pid
        const upper = level.toUpperCase().padEnd(5)

        return (
          `[Nest] ${pid}  - ${String(timestamp)}   ` +
          `${upper} ` +
          `[${serviceName}] ` +
          String(message)
        )
      }),
    ),

    transports: [
      new winston.transports.Console(),

      new winston.transports.File({
        filename: `logs/${serviceName}.log`,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
      }),
    ],
  })
}
