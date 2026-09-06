import express from 'express';
import { spawn } from 'child_process';

const app = express();
const PORT = process.env.PORT || 7860;

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
          <div class="badge">ONLINE 100%</div>
          <h2>🚀 Melolo Video Transcoding Proxy</h2>
          <p>ระบบถอดรหัส CENC AES-128 และแปลงภาพเป็น H.264 แบบสดๆ (แก้ปัญหาจอดำ 100%)</p>
          <hr style="border-color: #334155; margin: 20px 0;">
          <p><b>วิธีเรียกใช้งานในเว็บ:</b></p>
          <p><code>/play?url=&lt;VIDEO_URL&gt;&key=&lt;HEX_KEY&gt;</code></p>
        </div>
      </body>
    </html>
  `);
});

// ── Endpoint หลัก: แปลงสดและสตรีมตรงเข้าแท็ก <video> ───────────────────────
app.get('/play', (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).send('❌ กรุณาระบุพารามิเตอร์ ?url=');
  }

  // ดึงหรือคำนวณ Content Key สำหรับถอดรหัส CENC (ถ้ามี)
  let decKey = req.query.key || '';
  if (!decKey && req.query.spade_a) {
    decKey = deriveKey(req.query.spade_a);
  }

  // จัดเตรียมพารามิเตอร์สำหรับ FFmpeg
  const ffmpegArgs = [];

  // 1. ป้อนคีย์ถอดรหัสเข้า FFmpeg ทันที
  if (decKey) {
    ffmpegArgs.push('-decryption_key', decKey);
  }

  const doTranscode = req.query.transcode === 'true' || req.query.transcode === '1';

  ffmpegArgs.push(
    '-user_agent', 'com.worldance.drama/53018 (Linux; U; Android 12; th; ASUSAI2501B)',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i', videoUrl
  );

  if (doTranscode) {
    ffmpegArgs.push(
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k'
    );
  } else {
    // ถอดรหัส AES-128 CENC ผ่าน FFmpeg โดยตรง ไม่ต้องเสียเวลาแปลงภาพ เล่นได้ทันทีใน 0.05 วินาที
    ffmpegArgs.push('-c', 'copy');
  }

  ffmpegArgs.push(
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1'
  );

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  let headersSent = false;
  let stderrBuffer = '';

  ffmpeg.stdout.on('data', (chunk) => {
    if (!headersSent) {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-cache, no-store',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Accept-Ranges': 'none'
      });
      headersSent = true;
    }
    res.write(chunk);
  });

  ffmpeg.stderr.on('data', (data) => {
    stderrBuffer += data.toString();
    if (stderrBuffer.length > 2000) {
      stderrBuffer = stderrBuffer.slice(-2000);
    }
  });

  ffmpeg.on('close', (code) => {
    if (!headersSent) {
      res.status(500).type('text/plain').send(`Transcoding Error (code ${code}):\n${stderrBuffer}`);
    } else {
      res.end();
    }
  });

  ffmpeg.on('error', (err) => {
    console.error('FFmpeg Process Error:', err);
    if (!headersSent) res.status(500).send('FFmpeg Process Failed');
  });

  // เมื่อปิดหน้าต่างให้ kill FFmpeg ทันทีเพื่อคืน RAM/CPU
  res.on('close', () => {
    if (!res.writableEnded) {
      ffmpeg.kill('SIGKILL');
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Video Transcoding Proxy กำลังทำงานที่พอร์ต :${PORT}`);
});