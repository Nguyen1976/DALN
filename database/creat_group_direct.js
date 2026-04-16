// ============================================================
// CONFIGURATION - THAY ĐỔI TÊN DB CHO ĐÚNG VỚI MÁY BẠN
// ============================================================
var socialDB = db.getSiblingDB("social_network_db"); // DB chứa User/Friendships
var chatDB = db.getSiblingDB("chat_db");           // DB chứa Conversation

// ============================================================
// 1. LẤY TOÀN BỘ USER INFO VÀO RAM ĐỂ MAP DATA NHANH
// ============================================================
print("🚀 Đang cache thông tin User...");
var userMap = {};
socialDB.Users.find({}, { _id: 1, username: 1, fullName: 1, avatar: 1 }).forEach(function(u) {
    userMap[u._id.toString()] = u;
});

// ============================================================
// 2. TRUY VẤN CẶP BẠN BÈ ĐỂ TẠO CONVERSATION
// ============================================================
print("🚀 Đang xử lý Friendships để tạo Conversation...");

// Vì bảng Friendships của bạn lưu 2 chiều (A-B và B-A), 
// chúng ta chỉ cần xử lý một chiều để tránh tạo 2 conversation cho 1 cặp.
// Cách lách: Chỉ lấy những cặp mà userId < friendId (so sánh chuỗi)
var friendshipCursor = socialDB.Friendships.find({
    $expr: { $lt: [ { $toString: "$userId" }, { $toString: "$friendId" } ] }
});

var convBatch = [];
var memberBatch = [];
var BATCH_SIZE = 5000;
var count = 0;

friendshipCursor.forEach(function(rel) {
    var userA = userMap[rel.userId.toString()];
    var userB = userMap[rel.friendId.toString()];

    if (!userA || !userB) return;

    // Tạo ID cho Conversation trước để liên kết Member
    var conversationId = new ObjectId();
    var now = new Date();

    // 1. Tạo bản ghi Conversation (DIRECT)
    convBatch.push({
        _id: conversationId,
        type: "DIRECT",
        groupName: null,
        groupAvatar: null,
        memberCount: 2,
        lastMessageText: null,
        lastMessageAt: null,
        createdAt: now,
        updatedAt: now
    });

    // 2. Tạo 2 Member tương ứng
    [userA, userB].forEach(function(u) {
        memberBatch.push({
            conversationId: conversationId,
            userId: u._id,
            username: u.username,
            fullName: u.fullName,
            avatar: u.avatar,
            role: "MEMBER",
            isActive: true,
            unreadCount: 0,
            joinedAt: now
        });
    });

    // Bulk Insert để tối ưu hiệu năng
    if (convBatch.length >= BATCH_SIZE) {
        chatDB.conversation.insertMany(convBatch);
        chatDB.conversationMember.insertMany(memberBatch);
        count += convBatch.length;
        print("✅ Đã tạo: " + count + " conversations...");
        convBatch = [];
        memberBatch = [];
    }
});

// Chèn nốt phần còn lại
if (convBatch.length > 0) {
    chatDB.conversation.insertMany(convBatch);
    chatDB.conversationMember.insertMany(memberBatch);
    count += convBatch.length;
}

print("🎉 HOÀN TẤT! Đã tạo xong " + count + " hội thoại trực tiếp cho các cặp bạn bè.");