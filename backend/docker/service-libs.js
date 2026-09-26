/**
 * Build context tối thiểu cho MỘT service: giữ đúng các lib nó import (kể cả lib
 * mà lib đó import). File *.spec.ts vốn đã bị .dockerignore loại.
 *
 * Vì sao: Dockerfile từng `COPY libs libs` cho mọi service, nên sửa bất kỳ file
 * nào trong libs/ — kể cả lib service không dùng, hay một file test — là CI
 * build lại cả 6 image. Stage `build-context` chạy script này; COPY --from của
 * BuildKit tính cache theo NỘI DUNG, nên khi context lọc ra y hệt thì bước
 * `npm run build` phía sau vẫn ăn cache.
 *
 * Dùng:  node service-libs.js <SERVICE>          in ra danh sách lib
 *        node service-libs.js <SERVICE> --prune  xoá lib thừa tại chỗ
 * Chạy ở thư mục gốc backend (có libs/ và apps/<SERVICE>/).
 */
const fs = require('fs')
const path = require('path')

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|jest\.mock\s*\(\s*)['"](?:@app\/([\w-]+)|libs\/([\w-]+))/g

function tsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'generated') tsFiles(p, out)
    } else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p)
  }
  return out
}

function libsImportedBy(dir) {
  const found = new Set()
  for (const f of tsFiles(dir)) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(IMPORT_RE)) found.add(m[1] || m[2])
  }
  return found
}

function neededLibs(service) {
  const needed = new Set()
  const queue = [...libsImportedBy(path.join('apps', service))]
  while (queue.length) {
    const lib = queue.shift()
    if (needed.has(lib)) continue
    if (!fs.existsSync(path.join('libs', lib))) throw new Error(`lib không tồn tại: ${lib} (service ${service})`)
    needed.add(lib)
    for (const dep of libsImportedBy(path.join('libs', lib))) queue.push(dep)
  }
  return [...needed].sort()
}

module.exports = { neededLibs }

if (require.main === module) {
  const [service, flag] = process.argv.slice(2)
  if (!service) throw new Error('Thiếu SERVICE')
  const libs = neededLibs(service)
  if (flag === '--prune') {
    for (const lib of fs.readdirSync('libs')) {
      if (!libs.includes(lib)) fs.rmSync(path.join('libs', lib), { recursive: true, force: true })
    }
    console.log(`[service-libs] ${service}: giữ ${libs.join(', ')}`)
  } else {
    console.log(libs.join(' '))
  }
}
