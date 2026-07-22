# Stage 1: Build frontend
FROM node:22-alpine AS builder
WORKDIR /app

# Copy package files để cài đặt tất cả dependencies (bao gồm devDependencies của frontend)
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY scripts/install-yt-dlp.js ./scripts/install-yt-dlp.js

# Frontend không dùng yt-dlp; chỉ runtime mới cần tải binary theo đúng libc/CPU.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    YTDLP_AUTO_INSTALL=0
RUN npm ci

# Copy mã nguồn dự án để tiến hành build
COPY . .

# Thực hiện build frontend (lưu kết quả vào thư mục build/ ở root)
RUN npm run build:frontend

# Stage 2: Môi trường chạy ứng dụng Playwright sản phẩm
FROM mcr.microsoft.com/playwright:v1.61.1-noble
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY scripts/install-yt-dlp.js ./scripts/install-yt-dlp.js

# Bỏ qua việc tải xuống trình duyệt mới của Playwright vì image đã tích hợp sẵn trình duyệt tối ưu
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    YTDLP_PATH=/app/vendor/bin/yt-dlp \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe

# postinstall tải binary chính thức đã ghim, chọn đúng kiến trúc và xác minh SHA-256.
RUN npm ci --omit=dev

# Copy mã nguồn backend và các file cần thiết
COPY . .

# Copy thư mục build của frontend đã được biên dịch từ Stage 1
COPY --from=builder /app/build ./build

# Mở cổng kết nối (Port 3456)
EXPOSE 3456

# Cài đặt Xvfb và ffmpeg/ffprobe dùng cho luồng tách/cắt/ghép âm thanh.
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends xvfb ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && /app/vendor/bin/yt-dlp --version \
    && /usr/bin/ffmpeg -version \
    && /usr/bin/ffprobe -version

# Khởi chạy server Express bọc qua Xvfb với độ phân giải 1280x900
CMD xvfb-run --auto-servernum --server-args="-screen 0 1280x900x24" node server.js
