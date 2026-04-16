const { MongoClient } = require('mongodb');
const neo4j = require('neo4j-driver');

// Cấu hình
const MONGO_URI = 'mongodb://localhost:27017/user-service?replicaSet=rs0';
const NEO4J_URI = 'bolt://localhost:7687';
const NEO4J_USER = 'neo4j';
const NEO4J_PASSWORD = 'password123';
const BATCH_SIZE = 5000; // Số lượng quan hệ mỗi lần đẩy sang Neo4j

async function migrate() {
    const mongoClient = new MongoClient(MONGO_URI);
    const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
    
    try {
        await mongoClient.connect();
        const db = mongoClient.db('user-service'); // Tên DB của bạn
        const friendshipsCol = db.collection('Friendship');

        const session = driver.session();

        // BƯỚC 1: TẠO INDEX TRƯỚC KHI NẠP (BẮT BUỘC ĐỂ CHẠY NHANH)
        console.log("⏳ Đang tạo Index trên Neo4j...");
        await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (u:User) REQUIRE u.userId IS UNIQUE');

        // BƯỚC 2: ĐỌC DỮ LIỆU TỪ MONGO VÀ ĐẨY SANG NEO4J
        const cursor = friendshipsCol.find({}); // Lấy tất cả quan hệ
        let batch = [];
        let count = 0;

        console.log("🚀 Bắt đầu quá trình nạp dữ liệu...");

        while (await cursor.hasNext()) {
            const doc = await cursor.next();
            // Đưa vào mảng batch dưới dạng Object đơn giản
            batch.push({
                uId: doc.userId.toString(),
                fId: doc.friendId.toString()
            });

            if (batch.length === BATCH_SIZE) {
                await uploadBatch(session, batch);
                count += batch.length;
                console.log(`✅ Đã nạp: ${count} quan hệ`);
                batch = []; // Reset batch
            }
        }

        // Nạp nốt mẻ cuối
        if (batch.length > 0) {
            await uploadBatch(session, batch);
            count += batch.length;
        }

        console.log(`\n🎉 HOÀN TẤT! Đã chuyển ${count} quan hệ sang Neo4j.`);
        await session.close();

    } catch (err) {
        console.error("❌ Lỗi:", err);
    } finally {
        await mongoClient.close();
        await driver.close();
    }
}

/**
 * Hàm đẩy dữ liệu sang Neo4j bằng kỹ thuật UNWIND (Nhanh gấp 10-20 lần CREATE thông thường)
 */
async function uploadBatch(session, batch) {
    const cypher = `
        UNWIND $rows AS row
        MERGE (u1:User {userId: row.uId})
        MERGE (u2:User {userId: row.fId})
        MERGE (u1)-[:FRIEND]->(u2)
    `;
    try {
        // Driver v5 dùng executeWrite thay cho writeTransaction
        await session.executeWrite(tx => tx.run(cypher, { rows: batch }));
    } catch (err) {
        console.error("❌ Lỗi khi ghi mẻ dữ liệu:", err.message);
        // Với dữ liệu lớn, nếu lỗi "Pool out of capacity", bạn nên dừng 1 chút
        if (err.message.includes('Pool')) {
            await new Promise(res => setTimeout(res, 2000));
        }
    }
}

migrate();
/**
 * // Bước 1: Chọn ra 1000 user làm tâm điểm
MATCH (u:User)
WITH u LIMIT 1000

// Bước 2: Tìm tất cả bạn bè của 1000 người này
MATCH (u)-[r:FRIEND]-(neighbor:User)

// Bước 3: Trả về cả node gốc, sợi dây và node hàng xóm
RETURN u, r, neighbor
 * 
 */