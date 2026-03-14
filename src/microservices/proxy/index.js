const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

const PORT = process.env.PORT || 8000;
const MONOLITH_URL = process.env.MONOLITH_URL || 'http://localhost:8080';
const MOVIES_SERVICE_URL = process.env.MOVIES_SERVICE_URL || 'http://localhost:8081';
const EVENTS_SERVICE_URL = process.env.EVENTS_SERVICE_URL || 'http://localhost:8082';
const GRADUAL_MIGRATION = (process.env.GRADUAL_MIGRATION || 'false').toLowerCase() === 'true';
const MOVIES_MIGRATION_PERCENT = Math.min(100, Math.max(0, parseInt(process.env.MOVIES_MIGRATION_PERCENT || '0', 10)));

function shouldRouteToMicroservice() {
  if (!GRADUAL_MIGRATION) return true;
  return Math.random() * 100 < MOVIES_MIGRATION_PERCENT;
}

const monolithProxy = createProxyMiddleware({ target: MONOLITH_URL, changeOrigin: true });
const moviesProxy = createProxyMiddleware({ target: MOVIES_SERVICE_URL, changeOrigin: true });
const eventsProxy = createProxyMiddleware({ target: EVENTS_SERVICE_URL, changeOrigin: true });

app.get('/health', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send('Strangler Fig Proxy is healthy');
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/events')) {
    console.log(`[proxy] -> events-service ${req.method} ${req.originalUrl}`);
    return eventsProxy(req, res, next);
  }

  if (req.path.startsWith('/api/movies')) {
    if (shouldRouteToMicroservice()) {
      console.log(`[proxy] -> movies-service ${req.method} ${req.originalUrl}`);
      return moviesProxy(req, res, next);
    } else {
      console.log(`[proxy] -> monolith ${req.method} ${req.originalUrl}`);
      return monolithProxy(req, res, next);
    }
  }

  console.log(`[proxy] -> monolith ${req.method} ${req.originalUrl}`);
  monolithProxy(req, res, next);
});

app.listen(PORT, () => {
  console.log(`Strangler Fig Proxy starting on port ${PORT}`);
  console.log(`Config: GRADUAL_MIGRATION=${GRADUAL_MIGRATION}, MOVIES_MIGRATION_PERCENT=${MOVIES_MIGRATION_PERCENT}`);
});
