FROM node:20-alpine

# ติดตั้ง FFmpeg ลงใน Container
RUN apk update && apk add --no-cache ffmpeg

WORKDIR /app

# คัดลอกและติดตั้ง Node Dependencies
COPY package*.json ./
RUN npm install --production

# คัดลอกซอร์สโค้ดทั้งหมด
COPY . .

# รองรับพอร์ตทั้ง 7860 (Hugging Face Spaces) และ 3000 (Render/Railway/Koyeb)
ENV PORT=7860
EXPOSE 7860 3000

CMD ["node", "server.js"]
