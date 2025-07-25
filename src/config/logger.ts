import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for log messages
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      log += ` | ${JSON.stringify(meta)}`;
    }
    
    return log;
  })
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'HH:mm:ss'
  }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} ${level}: ${message}`;
    
    // Add metadata if present and not empty
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta, null, 2)}`;
    }
    
    return log;
  })
);

// Create transports array
const transports: winston.transport[] = [];

// Console transport for development
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      level: process.env.LOG_LEVEL || 'info',
      format: consoleFormat
    })
  );
}

// File transport for all environments
transports.push(
  new winston.transports.File({
    level: 'info',
    filename: path.join(logsDir, 'icpnomad.log'),
    format: logFormat,
    maxsize: parseInt(process.env.LOG_MAX_SIZE?.replace('m', '')) * 1024 * 1024 || 10 * 1024 * 1024, // Default 10MB
    maxFiles: parseInt(process.env.LOG_MAX_FILES || '5'),
    tailable: true
  })
);

// Error-specific file transport
transports.push(
  new winston.transports.File({
    level: 'error',
    filename: path.join(logsDir, 'error.log'),
    format: logFormat,
    maxsize: 5 * 1024 * 1024, // 5MB
    maxFiles: 3,
    tailable: true
  })
);

// Create logger instance
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: {
    service: 'icpnomad-backend',
    version: process.env.npm_package_version || '1.0.0'
  },
  transports,
  // Exit on error option
  exitOnError: false,
  // Handle exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      format: logFormat
    })
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      format: logFormat
    })
  ]
});

// Add request ID tracking utility
export const addRequestId = (req: any, res: any, next: any) => {
  const requestId = Math.random().toString(36).substring(2, 15);
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  
  // Create child logger with request ID
  req.logger = logger.child({ requestId });
  
  next();
};

// Stream for Morgan HTTP request logging
export const logStream = {
  write: (message: string) => {
    logger.info(message.trim(), { source: 'morgan' });
  }
};

// Utility functions for structured logging
export const logCanisterCall = (method: string, params?: any) => {
  logger.info(`Canister call initiated: ${method}`, {
    method,
    params: params ? JSON.stringify(params) : undefined,
    timestamp: new Date().toISOString(),
    source: 'canister-service'
  });
};

export const logCanisterResponse = (method: string, success: boolean, error?: string) => {
  const level = success ? 'info' : 'error';
  const message = `Canister call ${success ? 'completed' : 'failed'}: ${method}`;
  
  logger.log(level, message, {
    method,
    success,
    error,
    timestamp: new Date().toISOString(),
    source: 'canister-service'
  });
};

export const logUSSDRequest = (endpoint: string, metadata?: any) => {
  logger.info(`USSD request received: ${endpoint}`, {
    endpoint,
    metadata,
    timestamp: new Date().toISOString(),
    source: 'ussd-api'
  });
};

export const logUSSDResponse = (endpoint: string, success: boolean, statusCode: number) => {
  logger.info(`USSD response sent: ${endpoint}`, {
    endpoint,
    success,
    statusCode,
    timestamp: new Date().toISOString(),
    source: 'ussd-api'
  });
};

// Performance monitoring
export const performanceLogger = {
  start: (operation: string) => {
    const startTime = Date.now();
    return {
      end: () => {
        const duration = Date.now() - startTime;
        logger.info(`Performance: ${operation}`, {
          operation,
          duration: `${duration}ms`,
          timestamp: new Date().toISOString(),
          source: 'performance'
        });
      }
    };
  }
};

// Export logger as default
export default logger;