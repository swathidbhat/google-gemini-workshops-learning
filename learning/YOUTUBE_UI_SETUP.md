# YouTube Transcript UI - Setup Guide

## Quick Setup

### 1. Create `.env.local` file

```bash
cd learning
cp .env.example .env.local
```

Then edit `.env.local` and add your API key:

```
GOOGLE_API_KEY=your-actual-api-key-here
```

### 2. Start the development server

```bash
npm run dev
```

### 3. Open the UI

Navigate to: **http://localhost:3000/youtube-transcript**

## Usage

1. Paste a YouTube URL in the input field
2. Click "Process Video"
3. Wait for processing (usually 10-30 seconds)
4. The markdown file will be saved to `youtube/{videoId}/transcript.md`

## What Gets Created

- **Input**: YouTube URL
- **Output**: `youtube/{videoId}/transcript.md`
- **Next Step**: Use `chunk-paip.ts` to process the markdown

## Troubleshooting

### "GOOGLE_API_KEY not configured"
- Make sure `.env.local` exists in the `learning/` directory
- Make sure it contains: `GOOGLE_API_KEY=your-key`
- Restart the dev server after creating/editing `.env.local`

### "Failed to download transcript"
- The video may not have captions enabled
- Try a different video with captions

### Port already in use
- Change port: `npm run dev -- -p 3001`
- Or kill the process using port 3000

