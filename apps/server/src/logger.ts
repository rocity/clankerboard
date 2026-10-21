import { pino } from "pino";

export type Logger = pino.Logger;

export function createLogger(level: string, destination?: pino.DestinationStream): Logger {
  return pino({ level, base: undefined }, destination);
}
