import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool } from './lib/db.js';
import botStatusHandler from './api/bot-status.js';
import marketPricesHandler from './api/market-prices.js';
import statsHandler from './api/stats.js';
import tradesHandler from './api/trades.js';
import accountsHandler from './api/accounts.js';
import tradingHandler from './api/trading/index.js';
import accountPortfolioHandler from './api/account-portfolio.js';
import dashboardSummaryHandler from './api/dashboard-summary.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Safe error logging: avoid dumping pg Client refs (causes huge TLS/socket dumps and crashes)
function safeLogError(prefix, err) {
  const msg = err?.message ?? String(err);
  const stack = err?.stack;
  console.error(prefix, msg);
  if (stack && stack !== msg) console.error(stack);
}

getPool(); // Initialize pool and attach error handler (db.js)

function wrap(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      safeLogError('[api]', err);
      if (!res.headersSent) res.status(500).json({ error: 'Internal Server Error' });
      next(err);
    });
  };
}

// Mount Vercel-style API handlers for local dev (proxy matches /api/*)
app.get('/api/bot-status', wrap(botStatusHandler));
app.post('/api/bot-status', wrap(botStatusHandler));
app.get('/api/market-prices', wrap(marketPricesHandler));
app.get('/api/accounts', wrap(accountsHandler));
app.post('/api/accounts', wrap(accountsHandler));
app.delete('/api/accounts', wrap(accountsHandler));
app.get('/api/trading', wrap(tradingHandler));
app.post('/api/trading', wrap(tradingHandler));

app.get('/api/stats', wrap(statsHandler));
app.get('/api/trades', wrap(tradesHandler));
app.get('/api/account-portfolio', wrap(accountPortfolioHandler));
app.get('/api/dashboard-summary', wrap(dashboardSummaryHandler));

// Catch-all for undefined API endpoints
app.all('/api/{*path}', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Serve static files from the Vite build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
  
  // Handle React routing - return index.html for all non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    }
  });
}

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  if (process.env.NODE_ENV === 'production') {
    console.log('Serving production build');
  }
});