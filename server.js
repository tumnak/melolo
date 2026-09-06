import express from 'express';
import { spawn } from 'child_process';

const app = express();
const PORT = process.env.PORT || 7860; // 7860 รองรับ Hugging Face Spaces และ 3000/Render ได้โดยตรง

// ── เปิด CORS ให้ทุกเว็บดึงไปเล่นได้ ไม่ติดบล็อก ─────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── หน้าแรกสำหรับตรวจสอบสถานะ ───────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Video Transcoding Proxy</title></head>
      <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 40px;">
        <h2>🚀 Video Transcoding Proxy Online</h2>
        <p>พร้อมใช้งานสำหรับการแปลงภาพ HEVC / ByteVC1 ให้ออกเป็น H.264 แบบสดๆ (แก้ปัญหาจอดำ 100%)</p>
        <p><b>วิธีใช้งาน:</b></p>
        <code>/play?url=&lt;URL_วิดีโอต้นทาง&gt;</code>
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

  // กำหนด Header ให้เบราว์เซอร์รับเป็นสตรีม MP4
  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Cache-Control': 'no-cache, no-store',
    'Connection': 'keep-alive',
    'Accept-Ranges': 'none'
  });

  // รันคำสั่ง FFmpeg แปลงสดแบบ On-The-Fly (HEVC -> H.264 fMP4)
  const ffmpeg = spawn('ffmpeg', [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i', videoUrl,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',        // แปลงเร็วสุดระดับ Real-time
    '-tune', 'zerolatency',        // ไม่ต้องรอ Buffer ส่งเฟรมแรกออกไปทันที
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof', // ส่งเป็น Fragmented MP4 เข้า Pipe
    'pipe:1'
  ]);

  // ต่อท่อจาก FFmpeg ตรงเข้า Response ของเบราว์เซอร์
  ffmpeg.stdout.pipe(res);

  ffmpeg.stderr.on('data', (data) => {
    // console.log(`FFmpeg: ${data}`);
  });

  // ⚠️ สำคัญมาก: เมื่อคนดูปิดแท็บหรือหยุดดู สั่งฆ่า Process FFmpeg ทันทีเพื่อคืน CPU/RAM
  req.on('close', () => {
    ffmpeg.kill('SIGKILL');
  });

  ffmpeg.on('error', (err) => {
    console.error('FFmpeg Error:', err);
    if (!res.headersSent) res.status(500).send('Transcoding Error');
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Video Transcoding Proxy กำลังทำงานที่พอร์ต :${PORT}`);
});
