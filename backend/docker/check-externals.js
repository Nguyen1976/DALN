/**
 * Chặn image production thiếu dependency ngay lúc build.
 *
 * Webpack để node_modules ở ngoài bundle (externals), nên main.js vẫn gọi
 * require("x") lúc chạy. prune-prod-deps.sh xoá bớt package theo từng service;
 * xoá nhầm một package mà service còn dùng thì container chỉ chết lúc khởi động
 * ("Cannot find module") — tức là sau khi đã thay mất container cũ đang chạy tốt.
 * Kiểm ở đây để build fail trước, deploy dừng trước bước `up`.
 *
 * Dùng: node check-externals.js <SERVICE>
 */
const fs = require('fs')
const path = require('path')

const service = process.argv[2] || process.env.SERVICE
const entry = path.join('/app/dist/apps', service, 'main.js')
const source = fs.readFileSync(entry, 'utf8')

const modules = new Set()
for (const match of source.matchAll(
  /\b(?:require|import)\(\s*"([^"./][^"]*)"\s*\)/g,
)) {
  if (!match[1].startsWith('node:')) modules.add(match[1])
}

const missing = [...modules].filter((name) => {
  try {
    require.resolve(name, { paths: ['/app'] })
    return false
  } catch {
    return true
  }
})

if (missing.length) {
  console.error(
    `[check-externals] ${service}: thiếu module lúc chạy: ${missing.join(', ')}`,
  )
  console.error(
    '[check-externals] Kiểm tra docker/prune-prod-deps.sh có xoá nhầm package không.',
  )
  process.exit(1)
}

console.log(
  `[check-externals] ${service}: đủ ${modules.size} module ngoài bundle`,
)
