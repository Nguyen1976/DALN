module.exports = {
  apps: [
    {
      name: 'realtime-gateway',
      script: 'dist/apps/realtime-gateway/src/main.js', // Trỏ vào file đã build
      instances: '2',       // 'max' sẽ dùng TOÀN BỘ nhân CPU của máy bạn
      exec_mode: 'cluster',   // Bật chế độ đa luồng
      env: {
        NODE_ENV: 'development',
        PORT: 3001,
      },
    },
  ],
};