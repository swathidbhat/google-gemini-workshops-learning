# YouTube Transcript to Markdown - Setup & Usage

## API Key Required

This script needs a **Google Gemini API key** to format the transcript as markdown.

### Getting Your API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy your API key

### Setting Up the API Key

**Option 1: Environment Variable (Recommended)**

```bash
# For current terminal session
export GOOGLE_API_KEY="your-api-key-here"

# Or add to your shell profile (~/.zshrc, ~/.bashrc, etc.)
echo 'export GOOGLE_API_KEY="your-api-key-here"' >> ~/.zshrc
source ~/.zshrc
```

**Option 2: .env File (for Next.js projects)**

Create a `.env.local` file in the `learning/` directory:

```bash
cd learning
echo 'GOOGLE_API_KEY=your-api-key-here' > .env.local
```

**Option 3: Inline (for testing only)**

```bash
GOOGLE_API_KEY="your-api-key-here" npx ts-node scripts/youtube/transcript-to-markdown.ts "https://youtube.com/watch?v=..."
```

## What Doesn't Need an API Key

- **YouTube transcript download**: Uses the free `youtube-transcript` package (no API key needed)
- Only the **Gemini formatting step** requires the API key

## Testing the Script

### Quick Test

```bash
# Make sure you're in the learning/ directory
cd learning

# Set your API key
export GOOGLE_API_KEY="your-api-key-here"

# Run the script with a YouTube URL
npx ts-node scripts/youtube/transcript-to-markdown.ts "https://www.youtube.com/watch?v=kCc8FmEb1nY"
```

### Expected Output

```
📹 YouTube Transcript to Markdown Converter

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📹 Video ID: kCc8FmEb1nY
🔗 URL: https://www.youtube.com/watch?v=kCc8FmEb1nY

📥 Step 1: Downloading transcript from YouTube...
   ✅ Downloaded 1234 transcript segments

📝 Step 2: Processing transcript segments...
   ✅ Processed 1234 segments
   ⏱️  Total duration: 2:34:56

🤖 Step 3: Formatting transcript as markdown using Gemini...
   🔮 Calling Gemini to format transcript...
   ✅ Received formatted markdown (15.3s)

📊 Transcript Statistics:
   - Length: 45231 characters
   - Estimated words: ~9046
   - Preview (first 300 chars):
   ...

💾 Step 4: Saving markdown transcript...
   ✅ Saved to: youtube/kCc8FmEb1nY/transcript.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✨ Success! Transcript converted to markdown.

📝 Next steps:
   1. Review the markdown: youtube/kCc8FmEb1nY/transcript.md
   2. Chunk it using: npx ts-node scripts/chunk-paip.ts "youtube/kCc8FmEb1nY/transcript.md"
   3. Generate embeddings: npx ts-node scripts/embed-chunks.ts <chunks-output.json>
```

## Troubleshooting

### "GOOGLE_API_KEY not found in environment variables"

**Solution:** Set the environment variable before running:
```bash
export GOOGLE_API_KEY="your-key"
```

### "Failed to download transcript"

**Possible causes:**
- Video doesn't have captions enabled
- Video is private/restricted
- Network issues

**Solution:** Try a different video with captions enabled.

### "Received empty or very short markdown from Gemini"

**Possible causes:**
- API key is invalid
- Rate limiting
- Transcript is too long (try a shorter video first)

**Solution:** Check your API key and try again.

## Cost Estimate

- **YouTube transcript**: Free (no API calls)
- **Gemini formatting**: ~$0.01-0.05 per video (depends on length)
  - Gemini 2.5 Flash: Very affordable
  - Typical 1-hour video: ~$0.02-0.03

## Next Steps After Success

Once you have the markdown file:

1. **Chunk it semantically:**
   ```bash
   npx ts-node scripts/chunk-paip.ts youtube/{videoId}/transcript.md
   ```

2. **Generate embeddings:**
   ```bash
   npx ts-node scripts/embed-chunks.ts youtube/{videoId}/transcript-chunks.json
   ```

3. **Use in the learning app:**
   - Add to `public/data/libraries.json`
   - Or process through the concept graph extraction pipeline

