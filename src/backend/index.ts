import dotenv from 'dotenv';
import { createApp } from './app';
import { logger } from '../config/logger';
import { connectDatabase } from '../config/database';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        // Initialize database connection (optional MongoDB)
        await connectDatabase();
        
        // Create Express app
        const app = createApp();
        
        // Start server
        app.listen(PORT, () => {
            logger.info(`ICPNomad server started on port ${PORT}`);
            logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
            logger.info(`DFX Network: ${process.env.DFX_NETWORK || 'local'}`);
        });
        
    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    process.exit(0);
});

startServer();