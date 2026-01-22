<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1FdOgcEba9I1D9ET4wuYwEFcsQ8FVEscE

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Set the `DATABASE_URL` in [.env.local](.env.local) to your PostgreSQL connection string
4. Run the app:
   `npm run dev`

## Deploy to Vercel

1. Install Vercel CLI (if not already installed):
   `npm i -g vercel`

2. Login to Vercel:
   `vercel login`

3. Deploy:
   `vercel`

4. Set environment variables in Vercel dashboard:
   - `DATABASE_URL` - Your PostgreSQL connection string
   - `GEMINI_API_KEY` - Your Gemini API key (if needed)

5. For production deployment:
   `vercel --prod`

The app will automatically:
- Build the frontend with Vite
- Deploy API routes as serverless functions
- Serve the frontend from Vercel's CDN
