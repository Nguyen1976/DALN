// Chuẩn hoá email người dùng về dạng trim + chữ thường. Chạy MỘT lần, trước
// hoặc cùng lúc deploy bản backend chuẩn hoá email ở đầu vào: sau bản đó mọi
// email gửi lên đều là chữ thường, nên email cũ còn chữ hoa trong DB sẽ không
// khớp nữa và chủ tài khoản không đăng nhập được.
//
// Mặc định CHỈ BÁO CÁO. Đặt APPLY=1 để ghi. Dừng hẳn, không ghi gì, nếu có hai
// tài khoản trùng nhau khi bỏ qua hoa thường — trường hợp đó phải gộp tay.
//
//   docker cp scripts/normalize-user-emails.mongosh.js daln-prod-mongo:/tmp/
//   docker exec daln-prod-mongo mongosh --quiet user-service /tmp/normalize-user-emails.mongosh.js
//   docker exec -e APPLY=1 daln-prod-mongo mongosh --quiet user-service /tmp/normalize-user-emails.mongosh.js
//
// Dev: thay daln-prod-mongo bằng daln-mongo.

const apply = process.env.APPLY === '1'
const normalize = (email) => String(email).trim().toLowerCase()

const users = db.User.find({}, { email: 1 }).toArray()

const byNormalized = new Map()
for (const user of users) {
  const key = normalize(user.email)
  byNormalized.set(key, [...(byNormalized.get(key) ?? []), user])
}

const collisions = [...byNormalized.entries()].filter(([, list]) => list.length > 1)
if (collisions.length) {
  print(`DỪNG: ${collisions.length} email trùng nhau khi bỏ qua hoa thường — cần gộp tay:`)
  for (const [key, list] of collisions) {
    print(`  ${key}: ${list.map((u) => String(u._id)).join(', ')}`)
  }
  quit(1)
}

const todo = users.filter((u) => u.email !== normalize(u.email))
print(
  `${users.length} tài khoản, ${todo.length} email cần chuẩn hoá` +
    (apply ? '' : ' (chạy thử — đặt APPLY=1 để ghi)'),
)

for (const user of todo) {
  print(`  ${String(user._id)}: ${user.email} -> ${normalize(user.email)}`)
  if (apply) {
    db.User.updateOne(
      { _id: user._id },
      { $set: { email: normalize(user.email), updatedAt: new Date() } },
    )
  }
}
