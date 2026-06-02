import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv } from './types';
import { authRouter } from './routes/auth';

const app = new Hono<AppEnv>();

app.use('*', cors({
  origin: [
    'https://my-english-day.pages.dev',
    'http://localhost:8081',
    'http://localhost:19006',
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT,
  });
});

app.route('/auth', authRouter);

export default app;
