# Sử dụng image chính thức của Microsoft Playwright đã cài sẵn Chromium và dependencies
FROM mcr.microsoft.com/playwright:v1.49.0-noble

# Thiết lập thư mục làm việc trong container
WORKDIR /app

# Copy package.json và package-lock.json
COPY package*.json ./

# Bỏ qua việc tải xuống trình duyệt mới khi chạy npm install vì image đã có sẵn trình duyệt tối ưu
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Cài đặt các thư viện Node.js cần thiết cho môi trường Production
RUN npm install --production

# Copy toàn bộ mã nguồn dự án vào container (ngoại trừ các tệp được định nghĩa trong .dockerignore)
COPY . .

# Mở cổng kết nối (Port 3456)
EXPOSE 3456

# Khởi chạy ứng dụng
CMD ["node", "server.js"]
