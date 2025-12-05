/**
 * Transcribe audio file using Google Cloud Speech-to-Text v2
 * 
 * Usage:
 *   npx ts-node scripts/youtube/transcribe-audio.ts youtube/kCc8FmEb1nY/audio.mp3
 */

import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as http from 'http';
import { URL } from 'url';
import { exec } from 'child_process';

interface SegmentInfo {
  text: string;
  start: number;  // seconds (start time of this segment)
  end: number;    // seconds (end time of this segment)
  confidence: number;
}

interface TranscriptResult {
  video_id?: string;
  audio_file: string;
  total_duration: number;
  segments: SegmentInfo[];
  full_transcript: string;
  transcribed_at: string;
}

async function uploadToGCS(audioFile: string, projectId: string, accessToken: string): Promise<string> {
  const bucketName = `${projectId}-speech-transcripts`;
  const fileName = `transcripts/${Date.now()}-${path.basename(audioFile)}`;
  const gcsUri = `gs://${bucketName}/${fileName}`;
  
  console.log(`📦 Uploading to GCS: ${gcsUri}\n`);
  
  // Check if bucket exists, create if not
  const bucketUrl = `https://storage.googleapis.com/storage/v1/b/${bucketName}`;
  const checkResponse = await fetch(bucketUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  
  if (checkResponse.status === 404) {
    console.log(`📦 Creating bucket: ${bucketName}`);
    const createResponse = await fetch(`https://storage.googleapis.com/storage/v1/b?project=${projectId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: bucketName,
        location: 'US',
        storageClass: 'STANDARD',
      }),
    });
    
    if (!createResponse.ok) {
      const error = await createResponse.text();
      throw new Error(`Failed to create bucket: ${error}`);
    }
  }
  
  // Upload file using resumable upload
  const audioContent = await fs.readFile(audioFile);
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${bucketName}/o?uploadType=media&name=${encodeURIComponent(fileName)}`;
  
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'audio/mpeg',
    },
    body: audioContent,
  });
  
  if (!uploadResponse.ok) {
    const error = await uploadResponse.text();
    throw new Error(`Failed to upload to GCS: ${error}`);
  }
  
  console.log(`✅ Uploaded to GCS\n`);
  return gcsUri;
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_OAUTH2_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH2_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_OAUTH2_CLIENT_ID and GOOGLE_OAUTH2_CLIENT_SECRET must be set in .env.local');
  }

  const oauth2Client = new OAuth2Client(
    clientId,
    clientSecret,
    'http://localhost:8080'
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/cloud-speech'
    ],
  });

  console.log('🔐 OAuth2 Authentication Required');
  console.log('📋 Opening browser for authentication...\n');
  console.log(`If browser doesn't open, visit: ${authUrl}\n`);

  // Open browser
  exec(`open "${authUrl}"`);

  // Start local server to receive callback
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (!req.url) return;
      
      const url = new URL(req.url, 'http://localhost:8080');
      const code = url.searchParams.get('code');

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Authentication successful! You can close this window.</h1></body></html>');
        
        server.close();
        
        try {
          const { tokens } = await oauth2Client.getToken(code);
          if (!tokens.access_token) {
            reject(new Error('No access token received'));
            return;
          }
          resolve(tokens.access_token);
        } catch (error: any) {
          reject(new Error(`Failed to get token: ${error.message}`));
        }
      } else {
        res.writeHead(400);
        res.end('Missing authorization code');
      }
    });

    server.listen(8080, () => {
      console.log('⏳ Waiting for authentication...');
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timeout'));
    }, 300000);
  });
}

async function transcribeAudio(audioFile: string): Promise<TranscriptResult> {
  console.log(`🎙️  Transcribing: ${audioFile}\n`);

  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!projectId) {
    throw new Error('GOOGLE_CLOUD_PROJECT environment variable not set');
  }

  // Get OAuth2 access token
  const accessToken = await getAccessToken();
  console.log('✅ Authentication successful\n');

  // Check file size
  const stats = await fs.stat(audioFile);
  const fileSizeMB = stats.size / (1024 * 1024);
  console.log(`📊 File size: ${fileSizeMB.toFixed(2)} MB`);
  
  let audioUri: string | undefined;
  let audioContent: Buffer | undefined;
  
  // Use GCS for files > 10MB (API limit)
  if (fileSizeMB > 10) {
    console.log(`📦 File too large for inline upload, using GCS...\n`);
    audioUri = await uploadToGCS(audioFile, projectId, accessToken);
  } else {
    console.log(`✅ File size OK for direct upload\n`);
    audioContent = await fs.readFile(audioFile);
  }
  
  console.log('🔄 Sending to Google Cloud Speech-to-Text via REST API...');
  console.log('⏳ This may take a few minutes for long videos...\n');

  let apiResponse: any;
  
  if (audioUri) {
    // Use batch recognition for GCS files
    const batchUrl = `https://speech.googleapis.com/v2/projects/${projectId}/locations/global/recognizers/_:batchRecognize`;
    
    const batchRequest = {
      config: {
        autoDecodingConfig: {},
        languageCodes: ['en-US'],
        model: 'long',
        features: {
          enableAutomaticPunctuation: true,
        },
      },
      files: [{ uri: audioUri }],
      recognitionOutputConfig: {
        inlineResponseConfig: {},
      },
    };
    
    const batchResponse = await fetch(batchUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batchRequest),
    });
    
    if (!batchResponse.ok) {
      const errorText = await batchResponse.text();
      throw new Error(`Speech-to-Text API error: ${batchResponse.status} ${batchResponse.statusText}\n${errorText}`);
    }
    
    const batchResult = await batchResponse.json();
    const operationName = batchResult.name;
    
    console.log(`🔄 Operation started: ${operationName}\n`);
    console.log('⏳ Waiting for batch operation to complete...\n');
    
    // Poll for completion
    const operationUrl = `https://speech.googleapis.com/v2/${operationName}`;
    let done = false;
    let pollCount = 0;
    
    while (!done) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      pollCount++;
      
      if (pollCount % 4 === 0) {
        const elapsed = (pollCount * 5) / 60;
        console.log(`💓 Polling... (${elapsed.toFixed(1)} min elapsed)`);
      }
      
      const opResponse = await fetch(operationUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      
      const operation = await opResponse.json();
      done = operation.done;
      
      if (done) {
        // Save full operation for debugging
        await fs.writeFile('youtube/J8Eh7RqggsU/debug-operation.json', JSON.stringify(operation, null, 2));
        
        // The response is in operation.response, but it might be encoded
        if (operation.response) {
          apiResponse = operation.response;
        } else if (operation.result) {
          apiResponse = operation.result;
        } else {
          apiResponse = operation;
        }
        console.log('\n✅ Batch operation complete!\n');
      }
    }
  } else {
    // Use inline recognition for small files
    const apiUrl = `https://speech.googleapis.com/v2/projects/${projectId}/locations/global/recognizers/_:recognize`;
    const audioBase64 = audioContent!.toString('base64');
    
    const requestBody = {
      config: {
        autoDecodingConfig: {},
        languageCodes: ['en-US'],
        model: 'long',
        features: {
          enableAutomaticPunctuation: true,
        },
      },
      content: audioBase64,
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Speech-to-Text API error: ${response.status} ${response.statusText}\n${errorText}`);
    }

    apiResponse = await response.json();
  }
  
  // Extract results from response
  let response_data: any;
  if (audioUri) {
    // Batch response structure: response.results[GCS_URI].transcript.results
    const fileResult = apiResponse?.results?.[audioUri];
    if (fileResult?.transcript?.results) {
      response_data = { results: fileResult.transcript.results };
    } else {
      // Try alternative path or get first result
      const firstResult = Object.values(apiResponse?.results || {})[0] as any;
      if (firstResult?.transcript?.results) {
        response_data = { results: firstResult.transcript.results };
      } else if (firstResult?.inlineResult?.transcript?.results) {
        response_data = { results: firstResult.inlineResult.transcript.results };
      } else {
        await fs.writeFile('youtube/J8Eh7RqggsU/debug-api-response.json', JSON.stringify(apiResponse, null, 2));
        throw new Error('Could not parse batch response. Saved to debug-api-response.json');
      }
    }
  } else {
    response_data = { results: apiResponse.results || [] };
  }

  // Process results - extract segments with result-level timing
  const segments: SegmentInfo[] = [];
  let fullTranscript = '';
  let lastEndTime = 0;

  for (const result of response_data.results || []) {
    const alternative = result.alternatives?.[0];
    if (!alternative) continue;

    const text = alternative.transcript || '';
    fullTranscript += text + ' ';

    // Extract result-level end time - handle both string format ("9.250s") and object format
    let endSecs = 0;
    if (result.resultEndOffset) {
      if (typeof result.resultEndOffset === 'string') {
        // Parse string like "9.250s" or "647s"
        endSecs = parseFloat(result.resultEndOffset.replace('s', ''));
      } else {
        // Object format with seconds and nanos
        endSecs = Number(result.resultEndOffset.seconds || 0) + 
                 Number(result.resultEndOffset.nanos || 0) / 1e9;
      }
    }
    
    segments.push({
      text,
      start: lastEndTime,
      end: endSecs,
      confidence: alternative.confidence || 0,
    });
    
    lastEndTime = endSecs;
  }

  const totalDuration = segments.length > 0 ? segments[segments.length - 1].end : 0;

  console.log(`✅ Transcribed ${segments.length} segments`);
  console.log(`⏱️  Duration: ${formatDuration(totalDuration)}`);
  console.log(`📊 Average confidence: ${(segments.reduce((sum, s) => sum + s.confidence, 0) / segments.length * 100).toFixed(1)}%\n`);

  // Show sample
  console.log('📝 Sample (first 3 segments):\n');
  segments.slice(0, 3).forEach((seg, i) => {
    console.log(`  [${i + 1}] ${seg.text}`);
  });
  console.log();

  return {
    audio_file: audioFile,
    total_duration: totalDuration,
    segments,
    full_transcript: fullTranscript.trim(),
    transcribed_at: new Date().toISOString(),
  };
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  return `${m}m ${s}s`;
}

// Main execution
const audioFile = process.argv[2];

if (!audioFile) {
  console.error('Usage: npx ts-node scripts/youtube/transcribe-audio.ts <audio-file>');
  console.error('Example: npx ts-node scripts/youtube/transcribe-audio.ts youtube/kCc8FmEb1nY/audio.mp3');
  process.exit(1);
}

transcribeAudio(audioFile)
  .then(async (result) => {
    // Save results
    const outputFile = audioFile.replace(/\.(mp3|wav|m4a)$/, '-transcript.json');
    await fs.writeFile(outputFile, JSON.stringify(result, null, 2));
    
    console.log(`💾 Saved transcript to: ${outputFile}`);
    console.log('\n✨ Done!');
  })
  .catch(err => {
    console.error('\n💥 Failed:', err.message);
    process.exit(1);
  });
