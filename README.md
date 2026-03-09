# Planora — Web App

Full-stack AI-powered construction schedule analysis platform.

**Built by [Hoshmand AI](https://www.hoshmand.ai)**

## Features

- **Schedule Parsing**: Upload Primavera P6 (.xer), MS Project (.xml), or PDF files
- **AI Q&A**: Ask questions about your schedule in plain English (GPT-4o)
- **Reports**: Generate Executive Summary, Critical Path, Variance, and QA/QC reports
- **Dashboard**: Real-time metrics — variance, critical activities, near-term outlook
- **Timeline**: Phase view and Gantt chart visualization
- **Auth**: Sign up / sign in with email and password

## Tech Stack

- **Frontend**: Next.js 14, React, TypeScript, Tailwind CSS
- **Backend**: Next.js API routes (serverless)
- **AI**: OpenAI GPT-4o
- **Database**: JSON file storage (replace with PostgreSQL for production)
- **Parsing**: Custom XER, XML, and PDF parsers
- **Hosting**: Vercel

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/Hoshmand-AI/planora.git
cd planora

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env.local
# Edit .env.local and add your OpenAI API key

# 4. Run locally
npm run dev

# Open http://localhost:3000
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | Your OpenAI API key for AI features |
| `JWT_SECRET` | Yes | Secret for JWT token signing (change in production) |

## Deploy to Vercel

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables (OPENAI_API_KEY, JWT_SECRET)
4. Deploy

**Important**: The JSON file storage works for development but resets on Vercel serverless deployments. For production, connect a PostgreSQL database (Vercel Postgres, Supabase, or Neon).

## Project Structure

```
src/
├── app/
│   ├── page.tsx              # Marketing landing page
│   ├── auth/page.tsx         # Sign in / Sign up
│   ├── privacy/page.tsx      # Privacy Policy
│   ├── terms/page.tsx        # Terms of Service
│   ├── dashboard/
│   │   ├── layout.tsx        # App shell (header, tabs, schedule selector)
│   │   ├── page.tsx          # Dashboard (metrics, near-term, driving tasks)
│   │   ├── ask/page.tsx      # AI Q&A chat
│   │   ├── reports/page.tsx  # Report generation
│   │   └── timeline/page.tsx # Phases & Gantt
│   └── api/
│       ├── auth/route.ts     # Authentication
│       ├── schedules/route.ts # Upload & parse schedules
│       ├── ask/route.ts      # AI question answering
│       └── reports/route.ts  # Report generation
├── lib/
│   ├── auth.ts               # JWT & password utilities
│   ├── db.ts                 # Data storage layer
│   ├── openai.ts             # OpenAI integration
│   └── parsers/
│       ├── xer-parser.ts     # Primavera P6 XER parser
│       ├── xml-parser.ts     # MS Project XML parser
│       └── pdf-parser.ts     # PDF schedule parser
```

## Pages

| Route | Type | Description |
|-------|------|-------------|
| `/` | Public | Marketing landing page |
| `/auth` | Public | Sign in / Sign up |
| `/privacy` | Public | Privacy Policy |
| `/terms` | Public | Terms of Service |
| `/dashboard` | Protected | Main dashboard |
| `/dashboard/ask` | Protected | AI Q&A chat |
| `/dashboard/reports` | Protected | Report generation |
| `/dashboard/timeline` | Protected | Timeline & Gantt |
