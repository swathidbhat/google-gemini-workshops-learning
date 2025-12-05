/**
 * Simple YouTube audio download using youtubei.js with better error handling
 * 
 * Usage:
 *   npx ts-node scripts/youtube/download-video-simple.ts J8Eh7RqggsU
 */

import { Innertube } from 'youtubei.js/web';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createWriteStream } from 'fs';

function extractVideoId(input: string): string {
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return input;
  }
  
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }
  
  throw new Error(`Invalid YouTube URL or video ID: ${input}`);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

async function downloadVideo(videoInput: string): Promise<void> {
  const videoId = extractVideoId(videoInput);
  console.log(`📹 Downloading audio for: ${videoId}`);
  console.log(`🔗 URL: https://www.youtube.com/watch?v=${videoId}\n`);

  // Suppress console errors from youtubei.js
  const originalError = console.error;
  const errors: string[] = [];
  console.error = (...args: any[]) => {
    const msg = args.join(' ');
    if (msg.includes('Parser') || msg.includes('CourseProgressView') || msg.includes('Text')) {
      errors.push(msg);
      // Suppress these specific errors
      return;
    }
    originalError(...args);
  };

  try {
    // Initialize Innertube without cache to avoid IndexedDB issues
    const innertube = await Innertube.create();
    
    console.log('🔍 Getting video stream...');
    
    // Try to download directly without getting full info first
    const stream = await innertube.download(videoId, {
      type: 'audio',
      quality: 'best',
    });

    // Create output directory
    const outputDir = path.join(process.cwd(), 'youtube', videoId);
    await fs.mkdir(outputDir, { recursive: true });
    
    const audioPath = path.join(outputDir, 'audio.mp3');
    console.log(`💾 Downloading to: ${audioPath}\n`);

    // Write stream to file
    const fileStream = createWriteStream(audioPath);
    const reader = stream.getReader();
    let downloadedBytes = 0;
    let lastUpdate = Date.now();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      if (value) {
        downloadedBytes += value.length;
        fileStream.write(Buffer.from(value));
        
        const now = Date.now();
        if (now - lastUpdate > 1000) {
          process.stdout.write(`\r📥 Downloaded: ${formatBytes(downloadedBytes)}`);
          lastUpdate = now;
        }
      }
    }

    fileStream.end();
    await new Promise<void>((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });

    console.log(`\r📥 Downloaded: ${formatBytes(downloadedBytes)} ✅\n`);
    console.log(`💾 Saved to: ${audioPath}\n`);
    
    // Save basic metadata
    const metadataPath = path.join(outputDir, 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify({
      video_id: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      downloaded_at: new Date().toISOString(),
      file_size_bytes: downloadedBytes,
    }, null, 2));
    
    console.log(`✨ Download complete!`);
    
  } catch (error: any) {
    console.error = originalError; // Restore console.error
    throw new Error(`Download failed: ${error.message}`);
  } finally {
    console.error = originalError; // Restore console.error
  }
}

// Main execution
const videoInput = process.argv[2];

if (!videoInput) {
  console.error('Usage: npx ts-node scripts/youtube/download-video-simple.ts <video-id-or-url>');
  process.exit(1);
}

downloadVideo(videoInput)
  .then(() => {
    console.log('\n✅ Success!');
  })
  .catch(err => {
    console.error('\n💥 Error:', err.message);
    process.exit(1);
  });

