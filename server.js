import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

const app = express();
const PORT = process.env.PORT || 7860;

// โฟลเดอร์เก็บแคชวิดีโอที่ถอดรหัสแล้ว
const CACHE_DIR = path.join(os.tmpdir(), 'melolo_cache');
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (e) {}

// เก็บงานที่กำลังดาวน์โหลด/ถอดรหัสอยู่ เพื่อไม่ให้ทำซ้ำ
const activeJobs = new Map();

// เคลียร์แคชไฟล์ที่เก่าเกิน 2 ชั่วโมงทุกๆ 30 นาที เพื่อประหยัดพื้นที่ดิสก์
setInterval(() => {
  try {
    if (!fs.existsSync(CACHE_DIR)) return;
    const files = fs.readdirSync(CACHE_DIR);
    const now = Date.now();
    for (const file of files) {
      if (!file.endsWith('.mp4')) continue;
      const filePath = path.join(CACHE_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > 2 * 3600 * 1000) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {}
    }
  } catch (err) {}
}, 30 * 60 * 1000);

// ── ฟังก์ชันถอดรหัส spade_a เพื่อดึง AES-128 Content Key สำหรับ Melolo ─────────────
function decodeBase36(c) {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 122) return c - 97 + 10;
  return 0xFF;
}

function bitCount(n) {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return ((n + (n >> 4) & 0xF0F0F0F) * 0x1010101) >> 24;
}

function decryptSpadeInner(spadeKey) {
  const result = new Uint8Array(spadeKey);
  const buff = new Uint8Array(2 + spadeKey.length);
  buff.set([0xFA, 0x55], 0);
  buff.set(spadeKey, 2);
  for (let i = 0; i < result.length; i++) {
    let v = (spadeKey[i] ^ buff[i]) - bitCount(i) - 21;
    while (v < 0) { v += 0xFF; }
    result[i] = v;
  }
  return result;
}

function decryptSpade(spadeKeyBytes) {
  const spadeKeyLen = spadeKeyBytes.length;
  if (spadeKeyLen < 3) return '';
  const paddingLen = (spadeKeyBytes[0] ^ spadeKeyBytes[1] ^ spadeKeyBytes[2]) - 48;
  if (spadeKeyLen < paddingLen + 2) return '';
  const innerInput = spadeKeyBytes.slice(1, spadeKeyLen - paddingLen);
  const tmpBuff = decryptSpadeInner(innerInput);
  if (tmpBuff.length === 0) return '';
  const skipBytes = decodeBase36(tmpBuff[0]);
  const decodedMessageLen = spadeKeyLen - paddingLen - 2;
  const endIndex = 1 + decodedMessageLen - skipBytes;
  if (endIndex > tmpBuff.length) return '';
  const finalBytes = tmpBuff.slice(1, endIndex);
  return new TextDecoder('utf-8').decode(finalBytes);
}

function deriveKey(spadeAStr) {
  try {
    const buf = Buffer.from(spadeAStr, 'base64');
    return decryptSpade(new Uint8Array(buf));
  } catch (e) {
    return '';
  }
}

const PROXY_SECRET = process.env.PROXY_SECRET || "TumnakSeries_Melolo_Secure_2026!@#";

function verifyProxyToken(urlStr, expires, token) {
  if (!token || !expires) return false;
  const now = Math.floor(Date.now() / 1000);
  if (parseInt(expires, 10) < now) return false; // หมดอายุแล้ว

  try {
    const hmac = crypto.createHmac('sha256', PROXY_SECRET);
    hmac.update(`${urlStr}|${expires}`);
    const expected = hmac.digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    const tokenBuf = Buffer.from(token, 'hex');
    if (expectedBuf.length !== tokenBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, tokenBuf);
  } catch (e) {
    return false;
  }
}

// ── เปิด CORS ให้ทุกเว็บดึงไปเล่นได้ ไม่ติดบล็อก ─────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── หน้าแรกและเว็บเพลเยอร์สำหรับทดสอบ ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="th">
      <head>
        <meta charset="UTF-8">
        <title>Melolo Video Transcoder Proxy</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; display: flex; justify-content: center; align-items: center; min-height: 90vh; }
          .card { background: #1e293b; padding: 30px; border-radius: 12px; max-width: 600px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
          h2 { color: #38bdf8; margin-top: 0; }
          code { background: #0f172a; padding: 3px 8px; border-radius: 4px; color: #fbbf24; font-family: monospace; }
          .badge { display: inline-block; background: #22c55e; color: #000; font-weight: bold; padding: 4px 10px; border-radius: 20px; font-size: 12px; margin-bottom: 15px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="badge">SECURED &amp; PROTECTED</div>
          <h2>🛡️ Tumnak Video Proxy Service</h2>
          <p>Private video service for Tumnak Series. Direct hotlinking and unauthorized access are strictly forbidden.</p>
        </div>
      </body>
    </html>
  `);
});

// ── Endpoint หลัก: แปลงและสตรีมตรงพร้อม Range Support และ Full Duration ─────
app.get('/play', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).send('❌ กรุณาระบุพารามิเตอร์ ?url=');
  }

  // 🛡️ ป้องกันคนอื่นขโมยลิงก์ไปเปิดเล่นตรงๆ: ตรวจสอบ HMAC Token และวันหมดอายุ
  const token = req.query.token;
  const expires = req.query.expires;
  const masterSecret = req.query.secret || req.headers['x-proxy-secret'];

  const isAuthorized = (masterSecret === PROXY_SECRET) || verifyProxyToken(videoUrl, expires, token);
  if (!isAuthorized) {
    return res.status(403).type('text/plain; charset=utf-8').send('⛔ 403 Forbidden: ปฏิเสธการเข้าถึง - ลิงก์ไม่ได้รับอนุญาตหรือหมดอายุแล้ว');
  }

  // ดึงหรือคำนวณ Content Key สำหรับถอดรหัส CENC (ถ้ามี)
  let decKey = req.query.key || '';
  if (!decKey && req.query.spade_a) {
    decKey = deriveKey(req.query.spade_a);
  }

  // สร้าง Cache Key สำหรับไฟล์นี้
  const hash = crypto.createHash('md5').update(videoUrl + decKey).digest('hex');
  const cacheFile = path.join(CACHE_DIR, `${hash}.mp4`);
  const tempFile = path.join(CACHE_DIR, `${hash}.tmp.mp4`);

  // ฟังก์ชันส่งไฟล์ MP4 พร้อม Range Support และ Header ครบถ้วน
  const sendCachedVideo = () => {
    return res.sendFile(cacheFile, {
      acceptRanges: true,
      headers: {
        'Content-Type': 'video/mp4',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
        'Cache-Control': 'public, max-age=86400'
      }
    });
  };

  // 1. ถ้ามีไฟล์ในแคชแล้ว และขนาดไฟล์สมบูรณ์ (> 100KB) ส่งทันที!
  if (fs.existsSync(cacheFile)) {
    try {
      const st = fs.statSync(cacheFile);
      if (st.size > 102400) {
        return sendCachedVideo();
      }
    } catch (e) {}
  }

  // 2. ถ้ากำลังประมวลผลไฟล์นี้อยู่ ให้รอจนเสร็จแล้วส่ง
  if (activeJobs.has(hash)) {
    try {
      await activeJobs.get(hash);
      if (fs.existsSync(cacheFile)) {
        return sendCachedVideo();
      }
    } catch (e) {}
  }

  // 3. เริ่มกระบวนการถอดรหัส CENC แบบ Faststart (ใช้เวลาเพียง 1-2 วินาที)
  // ผลลัพธ์: จะได้ไฟล์ MP4 แท้ที่มีข้อมูลเวลาเต็มเรื่อง (Full Duration) และกรอเวลาได้ทันที
  const decryptPromise = new Promise((resolve, reject) => {
    const ffmpegArgs = [];
    if (decKey) {
      ffmpegArgs.push('-decryption_key', decKey);
    }
    ffmpegArgs.push(
      '-user_agent', 'com.worldance.drama/53018 (Linux; U; Android 12; th; ASUSAI2501B)',
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', videoUrl,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y',
      tempFile
    );

    const ff = spawn('ffmpeg', ffmpegArgs);
    let stderrBuf = '';
    ff.stderr.on('data', (d) => {
      stderrBuf += d.toString();
      if (stderrBuf.length > 2000) stderrBuf = stderrBuf.slice(-2000);
    });

    ff.on('close', (code) => {
      if (code === 0 && fs.existsSync(tempFile)) {
        try {
          fs.renameSync(tempFile, cacheFile);
          resolve(true);
        } catch (err) {
          reject(err);
        }
      } else {
        try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (e) {}
        reject(new Error(`FFmpeg exit code ${code}: ${stderrBuf}`));
      }
    });

    ff.on('error', (err) => {
      try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (e) {}
      reject(err);
    });
  });

  activeJobs.set(hash, decryptPromise);

  try {
    await decryptPromise;
    activeJobs.delete(hash);
    return sendCachedVideo();
  } catch (err) {
    activeJobs.delete(hash);
    console.error('Faststart error, falling back to pipe stream:', err.message);

    // Fallback สำรอง: หากเกิดข้อผิดพลาดในการสร้างไฟล์แคช ให้สตรีมสดผ่าน Pipe ทันที
    const fallbackArgs = [];
    if (decKey) fallbackArgs.push('-decryption_key', decKey);
    fallbackArgs.push(
      '-user_agent', 'com.worldance.drama/53018 (Linux; U; Android 12; th; ASUSAI2501B)',
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', videoUrl,
      '-c', 'copy',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      'pipe:1'
    );

    const ffLive = spawn('ffmpeg', fallbackArgs);
    let headersSent = false;
    ffLive.stdout.on('data', (chunk) => {
      if (!headersSent) {
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Cache-Control': 'no-cache, no-store',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Accept-Ranges': 'none'
        });
        headersSent = true;
      }
      res.write(chunk);
    });

    ffLive.on('close', () => res.end());
    req.on('close', () => { if (!res.writableEnded) ffLive.kill('SIGKILL'); });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Video Transcoding Proxy กำลังทำงานที่พอร์ต :${PORT}`);
});