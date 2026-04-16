// ==========================================
// CONFIGURATION
// ==========================================
var socialDB = db.getSiblingDB("user-service");
var chatDB = db.getSiblingDB("chat-service");

// 1. Kho tên Group "có ý nghĩa"
const groupNames = [
    "Hội Anh Em Gen Z", "Team Code Dạo", "Gia Đình Là Số 1", "Hội Ăn Trưa Phenikaa", 
    "CLB Khởi Nghiệp", "Lớp IT K14", "Team Backend NestJS", "Hội Yêu Mèo", 
    "Hội Đẩy Thuyền", "Team Marketing", "Dự Án Tốt Nghiệp", "Hội Phượt Tây Bắc",
    "Group Vô Tri", "Hội Nghiện Game", "Cộng Đồng Designer", "Kèo Nhậu Cuối Tuần"
];

const adjectives = ["Vui Vẻ", "Siêu Cấp", "Bất Diệt", "Nhiệt Huyết", "Tận Tâm", "Lầy Lội"];

// 2. Cache IDs của User (Cần khoảng 10k - 50k ID để random cho nhanh)
print("🚀 Đang lấy mẫu IDs người dùng để làm thành viên nhóm...");
const allUserIds = socialDB.User.find({}, { _id: 1, username: 1, fullName: 1, avatar: 1 }).limit(50000).toArray();

function getRandomGroupName() {
    return getRandom(groupNames) + " " + getRandom(adjectives);
}

function getRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ==========================================
// MAIN GENERATION
// ==========================================
const NUMBER_OF_GROUPS = 400000; // Bạn muốn sinh bao nhiêu Group?
const BATCH_SIZE = 1000;

let convBatch = [];
let memberBatch = [];

print(`🚀 Bắt đầu sinh ${NUMBER_OF_GROUPS} Group Chats...`);

for (let i = 0; i < NUMBER_OF_GROUPS; i++) {
    const convId = new ObjectId();
    const gName = getRandomGroupName();
    const now = new Date();
    
    // Chọn ngẫu nhiên số lượng thành viên từ 3 - 15 người
    const memberSize = Math.floor(Math.random() * 13) + 3;
    const selectedUsers = [];
    const usedIndexes = new Set();

    while (selectedUsers.length < memberSize) {
        const idx = Math.floor(Math.random() * allUserIds.length);
        if (!usedIndexes.has(idx)) {
            usedIndexes.add(idx);
            selectedUsers.push(allUserIds[idx]);
        }
    }

    // 1. Tạo Conversation GROUP
    convBatch.push({
        _id: convId,
        type: "GROUP",
        groupName: gName,
        groupAvatar: null,
        memberCount: memberSize,
        groupNameSearch: gName.toLowerCase(),
        lastMessageText: null,
        lastMessageAt: null,
        createdAt: now,
        updatedAt: now
    });

    // 2. Tạo Members
    selectedUsers.forEach((user, index) => {
        memberBatch.push({
            conversationId: convId,
            userId: user._id,
            username: user.username,
            fullName: user.fullName,
            avatar: user.avatar,
            role: index === 0 ? "ADMIN" : "MEMBER", // Người đầu tiên là Admin
            isActive: true,
            unreadCount: 0,
            joinedAt: now
        });
    });

    if (convBatch.length >= BATCH_SIZE) {
        chatDB.conversation.insertMany(convBatch);
        chatDB.conversationMember.insertMany(memberBatch);
        print(`✅ Đã xong ${i + 1} groups...`);
        convBatch = [];
        memberBatch = [];
    }
}

// Insert nốt số lẻ
if (convBatch.length > 0) {
    chatDB.conversation.insertMany(convBatch);
    chatDB.conversationMember.insertMany(memberBatch);
}

print("🎉 HOÀN TẤT SINH DỮ LIỆU GROUP CHAT!");