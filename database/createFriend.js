// ==========================================
// KỊCH BẢN TẠO GRAPH BẠN BÈ TRỰC TIẾP TRÊN MONGO SHELL
// ==========================================

print("🚀 BƯỚC 1: Đang kéo danh sách _id từ bảng Users lên RAM...");

// Dùng Projection để chỉ lấy _id, biến Cursor thành Array
const usersDocs = db.Users.find({}, { _id: 1 }).toArray();

// Ép kiểu mảng chỉ chứa ObjectID để dễ random
const allIds = usersDocs.map(doc => doc._id);
const totalUsers = allIds.length;

print(`✅ Đã lấy xong ${totalUsers} _id. Sẵn sàng tạo Đồ thị!`);

if (totalUsers === 0) {
    print("❌ LỖI: Không tìm thấy User nào trong Database. Hãy chạy kịch bản tạo User trước.");
    quit(); // Thoát script nếu không có user
}

print("\n🚀 BƯỚC 2: Tạo Index chống trùng lặp cho bảng Friendships...");
// Đảm bảo A và B không thể kết bạn 2 lần
db.Friendships.createIndex({ userId: 1, friendId: 1 }, { unique: true });


print("\n🚀 BƯỚC 3: Bắt đầu sinh Bạn bè ngẫu nhiên...");

const BATCH_SIZE = 10000; // Mỗi mẻ 10.000 dòng
let friendBatch = [];
let totalEdges = 0;

// Duyệt qua từng User để tìm bạn cho họ
for (let i = 0; i < totalUsers; i++) {
    const currentUserId = allIds[i];
    
    // Đổ xí ngầu: Mỗi người có từ 0 đến 30 bạn (Có người 0 bạn để test Cold-start)
 // Đổ xí ngầu: Mỗi người có từ 0 đến 30 bạn
const numberOfFriends = Math.floor(Math.random() * 30); 

// TẠO MỘT BỘ ĐỆM ĐỂ NHỚ NHỮNG AI ĐÃ KẾT BẠN (Dùng cho User hiện tại)
const currentFriends = new Set(); 

// DÙNG WHILE THAY VÌ FOR: Cứ tìm cho đến khi nào ĐỦ SỐ LƯỢNG thì thôi
while (currentFriends.size < numberOfFriends) {
    
    // Bốc ngẫu nhiên 1 người
    const randomIndex = Math.floor(Math.random() * totalUsers);
    const friendUserId = allIds[randomIndex];

    // 1. Kiểm tra: Tự kết bạn với chính mình? -> Next!
    if (currentUserId.equals(friendUserId)) continue; 

    // Chuyển ObjectId sang String để Set có thể nhận diện chính xác
    const friendIdStr = friendUserId.toString();

    // 2. Kiểm tra: Người này đã được bốc trúng trước đó chưa? -> Nếu rồi thì Next!
    if (currentFriends.has(friendIdStr)) continue; 

    // 3. Vượt qua mọi bài test -> Ghi nhớ người này vào Set để lần sau không bốc lại
    currentFriends.add(friendIdStr);

    const now = new Date();

    // TẠO BI-DIRECTIONAL (QUAN HỆ 2 CHIỀU)
    // Chiều A -> B
    friendBatch.push({
        userId: currentUserId,
        friendId: friendUserId,
        createdAt: now
    });

    // Chiều B -> A
    friendBatch.push({
        userId: friendUserId,
        friendId: currentUserId,
        createdAt: now
    });
}

    // Nếu gom đủ số lượng 1 mẻ thì đem Bulk Insert
    if (friendBatch.length >= BATCH_SIZE) {
        try {
            // ordered: false giúp DB im lặng chèn tiếp nếu gặp lỗi trùng lặp (Duplicate Key)
            db.Friendships.insertMany(friendBatch, { ordered: false });
        } catch (e) {
            // Im lặng bỏ qua lỗi trùng
        }
        
        totalEdges += friendBatch.length;
        print(`⏳ Đang xử lý... Đã nạp khoảng ~${totalEdges} connections.`);
        friendBatch = []; // Làm trống mảng để gom mẻ mới
    }
}

// Chèn nốt số dữ liệu lẻ còn dư ở cuối vòng lặp
if (friendBatch.length > 0) {
    try {
        db.Friendships.insertMany(friendBatch, { ordered: false });
        totalEdges += friendBatch.length;
    } catch (e) {}
}

print(`\n🎉 HOÀN TẤT! Đã phủ xong toàn bộ mạng lưới bạn bè cho ${totalUsers} Users!`);