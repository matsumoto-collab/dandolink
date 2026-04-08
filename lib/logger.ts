import * as Sentry from '@sentry/nextjs';

type LogContext = Record<string, unknown>;

function formatMessage(message: string, context?: LogContext): string {
  if (!context) return message;
  return `${message} ${JSON.stringify(context)}`;
}

export const logger = {
  error(message: string, error?: unknown, context?: LogContext) {
    console.error(formatMessage(message, context), error ?? '');
    if (error instanceof Error) {
      Sentry.captureException(error, { extra: { message, ...context } });
    } else if (error) {
      Sentry.captureMessage(message, { level: 'error', extra: { error, ...context } });
    }
  },

  warn(message: string, context?: LogContext) {
    console.warn(formatMessage(message, context));
  },

  info(message: string, context?: LogContext) {
    if (process.env.NODE_ENV === 'development') {
      console.info(formatMessage(message, context));
    }
  },
};
