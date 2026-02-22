import type { VisemeTimeline } from './types';
import { parseRhubarbJSON } from './rhubarbParser';

/**
 * Constructs the JSON URL for a given audio URL
 * 
 * Examples:
 * - `/audio/audio.wav` → `/audio/audio.json`
 * - `http://example.com/audio/file.mp3` → `http://example.com/audio/file.json`
 * 
 * @param audioUrl - URL of the audio file
 * @returns URL of the corresponding Rhubarb JSON file
 */
function getRhubarbJSONUrl(audioUrl: string): string {
  // Handle relative URLs
  if (audioUrl.startsWith('/')) {
    // Remove extension and add .json
    const lastDotIndex = audioUrl.lastIndexOf('.');
    if (lastDotIndex > 0) {
      return audioUrl.substring(0, lastDotIndex) + '.json';
    }
    return audioUrl + '.json';
  }
  
  // Handle absolute URLs
  try {
    const url = new URL(audioUrl);
    const pathname = url.pathname;
    const lastDotIndex = pathname.lastIndexOf('.');
    if (lastDotIndex > 0) {
      url.pathname = pathname.substring(0, lastDotIndex) + '.json';
    } else {
      url.pathname = pathname + '.json';
    }
    return url.toString();
  } catch {
    // If URL parsing fails, try simple string replacement
    const lastDotIndex = audioUrl.lastIndexOf('.');
    if (lastDotIndex > 0) {
      return audioUrl.substring(0, lastDotIndex) + '.json';
    }
    return audioUrl + '.json';
  }
}

/**
 * Loads Rhubarb JSON file for a given audio file
 * 
 * Automatically constructs the JSON URL based on the audio URL.
 * Returns null if the JSON file doesn't exist (for graceful fallback).
 * 
 * @param audioUrl - URL of the audio file (e.g., `/audio/audio.wav`)
 * @returns Promise resolving to VisemeTimeline if JSON found, null otherwise
 */
export async function loadRhubarbJSONForAudio(
  audioUrl: string
): Promise<VisemeTimeline | null> {
  const jsonUrl = getRhubarbJSONUrl(audioUrl);
  
  try {
    console.log(`Attempting to load Rhubarb JSON from: ${jsonUrl}`);
    
    const response = await fetch(jsonUrl);
    
    // If file doesn't exist, return null (not an error)
    if (response.status === 404) {
      console.log(`Rhubarb JSON not found at ${jsonUrl}, will use browser-based extraction`);
      return null;
    }
    
    if (!response.ok) {
      console.warn(`Failed to fetch Rhubarb JSON (${response.status}): ${response.statusText}`);
      return null;
    }
    
    // Check Content-Type to ensure it's JSON
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.includes('application/json')) {
      console.log(`Response is not JSON (Content-Type: ${contentType}), will use browser-based extraction`);
      return null;
    }
    
    // Get response text first to check if it's HTML (404 page)
    const text = await response.text();
    
    // Check if response is HTML (likely a 404 page from dev server)
    if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<!doctype') || text.trim().startsWith('<html')) {
      console.log(`Rhubarb JSON not found (received HTML response), will use browser-based extraction`);
      return null;
    }
    
    // Try to parse as JSON
    let json;
    try {
      json = JSON.parse(text);
    } catch (parseError) {
      console.warn(`Invalid JSON format in Rhubarb file: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
      return null;
    }
    
    const timeline = parseRhubarbJSON(json);
    
    console.log(`Successfully loaded Rhubarb JSON with ${timeline.visemes.length} viseme keyframes`);
    return timeline;
    
  } catch (error) {
    // Handle network errors gracefully
    console.warn(`Error loading Rhubarb JSON: ${error}`);
    return null;
  }
}

