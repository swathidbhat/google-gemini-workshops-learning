/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';
import { YoutubeTranscript } from 'youtube-transcript';

// Extract video ID from various YouTube URL formats
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Format timestamp as HH:MM:SS or MM:SS
function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Configure route timeout (Next.js default is 10s for Hobby, 60s for Pro)
export const maxDuration = 60; // 60 seconds max

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    
    if (!url) {
      return NextResponse.json(
        { error: 'YouTube URL is required' },
        { status: 400 }
      );
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: 'Invalid YouTube URL format' },
        { status: 400 }
      );
    }

    // Get API key from environment
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GOOGLE_API_KEY not configured. Please add it to .env.local' },
        { status: 500 }
      );
    }

    // Step 1: Get transcript directly from YouTube (uses fetch internally)
    console.log(`[${videoId}] Step 1/2: Fetching transcript from YouTube...`);
    
    let transcriptText: string = '';
    
    // Try languages in order: 'en' first (most common), then variants, then no language specified
    const languageCodes = ['en', 'en-US', 'en-GB', undefined];
    let lastError: Error | null = null;
    
    for (const lang of languageCodes) {
      try {
        const langLabel = lang || 'default';
        console.log(`[${videoId}] Trying language: ${langLabel}`);
        
        const rawTranscript = lang 
          ? await YoutubeTranscript.fetchTranscript(videoId, { lang })
          : await YoutubeTranscript.fetchTranscript(videoId);
        
        if (!rawTranscript || rawTranscript.length === 0) {
          throw new Error('Transcript is empty');
        }
        
        // Combine all transcript segments into a single text
        transcriptText = rawTranscript.map(item => item.text).join(' ');
        
        if (!transcriptText || transcriptText.trim().length < 50) {
          throw new Error('Transcript is too short');
        }
        
        console.log(`[${videoId}] Successfully fetched transcript with language: ${langLabel} (${rawTranscript.length} segments, ${transcriptText.length} characters)`);
        break; // Success, exit loop
        
      } catch (error: any) {
        lastError = error;
        console.log(`[${videoId}] Failed with language ${lang || 'default'}: ${error.message}`);
        continue; // Try next language
      }
    }
    
    if (!transcriptText || transcriptText.trim().length < 50) {
      const errorMsg = lastError?.message || 'Unknown error';
      throw new Error(`Failed to fetch transcript. The video may not have captions available. Last error: ${errorMsg}`);
    }
    
    // Step 2: Format transcript with Gemini (matching learning module format)
    console.log(`[${videoId}] Step 2/2: Formatting transcript with Gemini...`);
    
    const formattingPrompt = `You are a content formatter. Convert this YouTube video transcript into well-structured markdown.

Video URL: ${url}
Video ID: ${videoId}

TRANSCRIPT:
${transcriptText.substring(0, 200000)}${transcriptText.length > 200000 ? '\n[... transcript continues ...]' : ''}

Format as markdown:
- Use # for title, ## for sections, ### for subsections
- Include timestamps [MM:SS] at section breaks when available
- Format code in code blocks with language tags
- Remove filler words ("um", "uh") but preserve meaning
- Group related content into logical sections
- Preserve technical terminology and code examples

Return ONLY the markdown, no commentary.`;

    const model = 'gemini-2.5-flash';
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{
              text: formattingPrompt,
            }],
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 32000,
          },
        }),
      }
    );

    if (!response.ok) {
      let errorMessage = `Gemini API failed: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData.error?.message) {
          errorMessage = errorData.error.message;
          
          // Handle token limit exceeded error
          if (errorMessage.includes('token count exceeds') || errorMessage.includes('maximum number of tokens')) {
            throw new Error('❌ Video is too long for direct processing.\n\nThe video exceeds Gemini\'s token limit (1,048,576 tokens). This typically happens with videos longer than ~2-3 hours.\n\n💡 Solutions:\n• Try a shorter video (under ~2 hours recommended)\n• Use maxDurationMinutes to limit processing to first 30 minutes\n• Process the video in segments using different time ranges');
          }
        } else if (errorData.error) {
          errorMessage = JSON.stringify(errorData.error);
        }
        console.error('Gemini API error details:', JSON.stringify(errorData, null, 2));
      } catch (e: any) {
        // If we already threw a custom error, re-throw it
        if (e.message?.includes('Video is too long')) {
          throw e;
        }
        const errorText = await response.text();
        console.error('Gemini API error (text):', errorText);
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    
    // Check for errors in response
    if (data.error) {
      throw new Error(data.error.message || JSON.stringify(data.error));
    }
    
    // Extract text from response (same pattern as socratic-dialogue route)
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('No candidates in Gemini response');
    }
    
    const textPart = data.candidates[0]?.content?.parts?.find(
      (part: any) => part.text !== undefined
    );
    
    if (!textPart || !textPart.text) {
      console.error('Response structure:', JSON.stringify(data, null, 2));
      throw new Error('No text response from Gemini');
    }

    const markdownContent = textPart.text.trim();

    if (!markdownContent || markdownContent.length < 100) {
      throw new Error('Received empty or very short markdown from Gemini');
    }

    // Save markdown file
    const outputDir = path.join(process.cwd(), 'youtube', videoId);
    await fs.mkdir(outputDir, { recursive: true });
    
    const outputPath = path.join(outputDir, 'transcript.md');
    await fs.writeFile(outputPath, markdownContent, 'utf-8');

    return NextResponse.json({
      success: true,
      videoId,
      outputPath: `youtube/${videoId}/transcript.md`,
      stats: {
        markdownLength: markdownContent.length,
        estimatedWords: Math.round(markdownContent.length / 5),
      },
    });

  } catch (error: any) {
    console.error('Error processing YouTube transcript:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process YouTube video' },
      { status: 500 }
    );
  }
}

