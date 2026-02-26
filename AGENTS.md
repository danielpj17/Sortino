# Agents

## Cursor Cloud specific instructions

### Architecture

Sortino is an AI-powered stock trading platform with three services:

| Service | Tech | Port | Start Command |
|---------|------|------|---------------|
| Frontend | React 19 + Vite 6 | 3000 | `npx vite --port 3000 --host 0.0.0.0` |
| Backend API | Express 5 (Node.js) | 3001 | `node server.js` |
| Python Model API | Flask + Stable Baselines3 | 5000 | `cd python_engine && python3 model_api.py` |

All three services are needed for end-to-end functionality. The frontend proxies `/api` to port 3001. The backend calls the Model API at `MODEL_API_URL` (defaults to `http://localhost:5000`).

### Database

A local PostgreSQL 16 instance is available. Schema is in `schema.sql`. To start PostgreSQL and set up the database:

```bash
sudo pg_ctlcluster 16 main start
# Database "sortino" with user "sortino" / password "sortino" is pre-created
```

### Running services locally

Each service needs specific environment variables. Start them with:

```bash
# Backend (port 3001) — needs DATABASE_URL, ENCRYPTION_KEY, MODEL_API_URL
# Use local PostgreSQL with user/password "sortino", db "sortino", and append ?uselibpqcompat=true
# Set ENCRYPTION_KEY to any 32+ char string for dev, MODEL_API_URL to http://localhost:5000
node server.js

# Frontend (port 3000) — in separate terminal
npx vite --port 3000 --host 0.0.0.0

# Python Model API (port 5000) — in separate terminal, needs DATABASE_URL
cd python_engine && python3 model_api.py
```

Or use `npm run dev` to start frontend + backend together (but you still need the Python service separately).

### Non-obvious gotchas

- **pg SSL compatibility**: The `lib/db.js` forces `sslmode=require` on every connection string. With local PostgreSQL (self-signed cert), you must include `uselibpqcompat=true` in the `DATABASE_URL` or connections will fail with "self-signed certificate". This only affects local dev — Neon cloud PostgreSQL works fine with the default.
- **Express 5 wildcards**: Express 5 uses path-to-regexp v8, which requires `{*path}` syntax for catch-all routes instead of bare `*`.
- **Python user-installed packages**: pip installs to `~/.local/lib/python3.12/site-packages`. Ensure `~/.local/bin` is on PATH if running Python CLI tools directly.
- **Model loading**: The Python API loads `dow30_model.zip` (or `dow30_sortino_model.zip` / `dow30_upside_model.zip`) from `python_engine/`. If models are missing, `/predict` returns 503 but `/health` still returns 200.

### Lint / Build / Test

- **TypeScript check**: `npx tsc --noEmit`
- **Vite build**: `npx vite build`
- No ESLint config or test framework is configured in the project.
