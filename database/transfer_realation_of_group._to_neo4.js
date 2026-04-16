const { MongoClient } = require("mongodb");
const neo4j = require("neo4j-driver");

const MONGO_URI = "mongodb://localhost:27017";
const NEO4J_URI = "bolt://localhost:7687";
const NEO4J_USER = "neo4j";
const NEO4J_PASSWORD = "password123";

async function migrateGroups() {
  const mongoClient = new MongoClient(MONGO_URI);
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD), {
    encrypted: "ENCRYPTION_OFF",
  });

  try {
    await mongoClient.connect();
    const chatDb = mongoClient.db("chat-service");
    const convCol = chatDb.collection("conversation");
    const memberCol = chatDb.collection("conversationMember");

    // Tạo session để làm Index trước
    const setupSession = driver.session();
    console.log("⏳ 1. Tạo Index/Constraint...");
    await setupSession.run("CREATE CONSTRAINT IF NOT EXISTS FOR (g:Group) REQUIRE g.conversationId IS UNIQUE");
    await setupSession.run("CREATE CONSTRAINT IF NOT EXISTS FOR (u:User) REQUIRE u.userId IS UNIQUE");
    await setupSession.close();

    const groupCursor = convCol.find({ type: "GROUP" });
    let processedGroups = 0;
    let startTime = Date.now();

    console.log("🚀 2. Bắt đầu nạp dữ liệu (Batching)...");

    while (await groupCursor.hasNext()) {
        let groupDataBatch = [];
        
        // Gom 50 Group vào 1 mảng để xử lý 1 lần
        for (let i = 0; i < 50 && await groupCursor.hasNext(); i++) {
            const group = await groupCursor.next();
            // Lấy member của group này
            const members = await memberCol.find({ conversationId: group._id }).toArray();
            
            groupDataBatch.push({
                gId: group._id.toString(),
                gName: group.groupName,
                members: members.map(m => ({ uId: m.userId.toString(), role: m.role }))
            });
        }

        if (groupDataBatch.length > 0) {
            // Mỗi mẻ lớn dùng 1 session riêng và đóng ngay sau khi xong
            const session = driver.session();
            try {
                const cypher = `
                    UNWIND $batch AS groupItem
                    MERGE (g:Group {conversationId: groupItem.gId})
                    SET g.name = groupItem.gName
                    WITH g, groupItem
                    UNWIND groupItem.members AS member
                    MATCH (u:User {userId: member.uId})
                    MERGE (u)-[r:MEMBER_OF]->(g)
                    SET r.role = member.role
                `;
                await session.executeWrite(tx => tx.run(cypher, { batch: groupDataBatch }));
            } catch (err) {
                console.error("❌ Lỗi ghi mẻ:", err.message);
            } finally {
                await session.close(); // Quan trọng: Đóng session để giải phóng pool
            }
        }

        processedGroups += groupDataBatch.length;
        if (processedGroups % 500 === 0) {
            const elapsed = (Date.now() - startTime) / 1000;
            console.log(`✅ Tiến độ: ${processedGroups} / 400,000 groups. Tốc độ: ${(processedGroups / elapsed).toFixed(1)} grp/s`);
        }
    }

    console.log("\n🎉 MIGRATION HOÀN TẤT!");
  } catch (err) {
    console.error("❌ Lỗi hệ thống:", err);
  } finally {
    await mongoClient.close();
    await driver.close();
  }
}

migrateGroups();

/**
 * // Bước 1: Lấy 1000 user làm tập gốc
MATCH (u:User)
WITH u LIMIT 1000

// Bước 2: Tìm các Group mà 1000 user này tham gia
MATCH (u)-[r:MEMBER_OF]->(g:Group)

// Bước 3: Trả về cả node User, Group và sợi dây kết nối
RETURN u, r, g
 * 
MATCH (u:User) WITH u LIMIT 1000
MATCH (u)-[r:MEMBER_OF]->(g:Group)
WITH g, collect(u) AS members, collect(r) AS rels
WHERE size(members) > 1 // Chỉ lấy những Group có ít nhất 2 người trong tập 1000 tham gia
RETURN g, members, rels
 * 
 * 
 */