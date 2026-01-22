# Vercel Deployment Guide

## Project Structure for Vercel

```
├── api/                    # Serverless functions
│   ├── db.js              # Shared database connection
│   ├── trades.js          # GET /api/trades
│   ├── stats.js           # GET /api/stats
│   ├── trades/
│   │   └── [type].js      # GET /api/trades/:type
│   └── stats/
│       └── [type].js      # GET /api/stats/:type
├── components/            # React components
├── dist/                  # Built frontend (generated)
├── vercel.json            # Vercel configuration
└── package.json
```

## Environment Variables

Set these in Vercel Dashboard → Settings → Environment Variables:

- `DATABASE_URL` - Your PostgreSQL connection string
- `GEMINI_API_KEY` - Your Gemini API key (optional, if used)

## Deployment Steps

### Option 1: Vercel CLI

```bash
# Install Vercel CLI globally
npm i -g vercel

# Login
vercel login

# Deploy (preview)
vercel

# Deploy to production
vercel --prod
```

### Option 2: GitHub Integration

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Click "New Project"
4. Import your GitHub repository
5. Vercel will auto-detect Vite and configure it
6. Add environment variables in the dashboard
7. Deploy!

## How It Works

- **Frontend**: Built with Vite and served from Vercel's CDN
- **API Routes**: Converted to serverless functions in `/api` folder
- **Database**: Uses connection pooling (shared across function invocations)
- **Routing**: Vercel handles React Router via `vercel.json` rewrites

## Local Development

The `server.js` file is still used for local development. When you run `npm run dev`, it uses:
- Vite dev server (port 3000)
- Express server (port 3001)

For production on Vercel, only the `/api` serverless functions are used.
