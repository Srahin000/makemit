#!/usr/bin/env node

/**
 * Process a single audio file with Rhubarb Lip Sync
 * 
 * Usage:
 *   node scripts/process-audio.js <audio-file>
 * 
 * Example:
 *   node scripts/process-audio.js public/audio/audio.wav
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to find rhubarb.exe in local installation first
function findRhubarbExecutable() {
  // Check for local installation in project
  const localRhubarb = path.join(__dirname, '..', 'rhubarb', 'Rhubarb-Lip-Sync-1.14.0-Windows', 'rhubarb.exe');
  if (fs.existsSync(localRhubarb)) {
    return localRhubarb;
  }
  
  // Check for any version in rhubarb directory
  const rhubarbDir = path.join(__dirname, '..', 'rhubarb');
  if (fs.existsSync(rhubarbDir)) {
    const files = fs.readdirSync(rhubarbDir, { recursive: true });
    const exeFile = files.find(f => f.endsWith('rhubarb.exe'));
    if (exeFile) {
      return path.join(rhubarbDir, exeFile);
    }
  }
  
  // Fall back to system PATH
  return 'rhubarb';
}

const rhubarbExe = findRhubarbExecutable();

// Get audio file path from command line
const audioFile = process.argv[2];

if (!audioFile) {
  console.error('Error: No audio file specified');
  console.log('Usage: node scripts/process-audio.js <audio-file>');
  console.log('Example: node scripts/process-audio.js public/audio/audio.wav');
  process.exit(1);
}

// Check if audio file exists
if (!fs.existsSync(audioFile)) {
  console.error(`Error: Audio file not found: ${audioFile}`);
  process.exit(1);
}

// Construct output JSON path (same directory, same name, .json extension)
const audioDir = path.dirname(audioFile);
const audioName = path.basename(audioFile, path.extname(audioFile));
const jsonFile = path.join(audioDir, `${audioName}.json`);

console.log(`Processing: ${audioFile}`);
console.log(`Output: ${jsonFile}`);

try {
  // Run Rhubarb
  // Command: rhubarb -f json -o output.json input.wav
  const command = `"${rhubarbExe}" -f json -o "${jsonFile}" "${audioFile}"`;
  
  console.log(`Running: ${command}`);
  execSync(command, { stdio: 'inherit' });
  
  console.log(`\n✅ Success! Rhubarb JSON created: ${jsonFile}`);
  console.log(`The web app will automatically use this file for accurate lip-sync.`);
  
} catch (error) {
  if (error.message.includes('rhubarb') || error.message.includes('not found') || error.message.includes('ENOENT')) {
    console.error('\n❌ Error: Rhubarb CLI not found');
    console.error(`Tried to use: ${rhubarbExe}`);
    console.error('\nOptions:');
    console.error('1. Run: powershell -ExecutionPolicy Bypass -File scripts\\download-rhubarb.ps1');
    console.error('2. Or download manually from: https://github.com/DanielSWolf/rhubarb-lip-sync/releases');
    console.error('3. Or add Rhubarb to your PATH');
  } else {
    console.error(`\n❌ Error processing audio: ${error.message}`);
  }
  process.exit(1);
}

