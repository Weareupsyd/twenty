import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables manually
try {
  const envPath = join(__dirname, '../../.env');
  const envFile = readFileSync(envPath, 'utf8');
  
  envFile
    .split('\n')
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        const envKey = key.trim();
        process.env[envKey] = value;
      }
    });
    
  console.log(' Environment variables loaded');
} catch (error) {
  console.warn(' Could not load .env file, using defaults');
}

export const config = {
  port: parseInt(process.env.PORT || '3001'),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176', 'https://kabila.app', 'https://www.kabila.app', 'https://customer.kabila.app'],
  
  // Supabase configuration
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
  },
  
  // Security
  jwtSecret: process.env.JWT_SECRET || 'jwt_secret_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
  apiKeySecret: process.env.API_KEY_SECRET || 'api_secret_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',

  // WhatsApp Service
  whatsapp: {
    serviceUrl: process.env.WHATSAPP_SERVICE_URL || 'http://104.248.16.109:8080',
    apiKey: process.env.WHATSAPP_API_KEY || 'WFhUryqpgSYVVgeSHYq6k'
  },
  
  // Rate limiting
  rateLimiting: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '3600000'), // 1 hour
    maxRequestsPerUser: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_PER_USER || '5'),
    maxRequestsPerDev: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_PER_DEV || '1000')
  },

  // Sandbox mode
  sandbox: {
    enabled: process.env.SANDBOX_MODE === 'true',
    mockVerification: process.env.ENABLE_MOCK_VERIFICATION === 'true',
    mockDelayMs: parseInt(process.env.MOCK_VERIFICATION_DELAY_MS || '2000')
  }
};

export default config;