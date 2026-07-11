# Stage 1: Build frontend
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files để cài đặt tất cả dependencies (bao gồm devDependencies của frontend)
COPY package*.json ./
COPY frontend/package*.json ./frontend/

# Cài đặt toàn bộ dependencies
RUN npm install

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

# Bỏ qua việc tải xuống trình duyệt mới của Playwright vì image đã tích hợp sẵn trình duyệt tối ưu
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Chỉ cài đặt production dependencies để tối ưu dung lượng
RUN npm install --omit=dev

# Copy mã nguồn backend và các file cần thiết
COPY . .

# Copy thư mục build của frontend đã được biên dịch từ Stage 1
COPY --from=builder /app/build ./build

# Mở cổng kết nối (Port 3456)
EXPOSE 3456

# Khởi chạy server Express bằng Node.js trực tiếp
CMD ["node", "server.js"]

