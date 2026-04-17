const { MongoClient } = require("mongodb");
const axios = require("axios");

async function run() {
    const client = new MongoClient("mongodb://localhost:27017");
    const BATCH_SIZE = 1; // Có thể nâng lên 500 vì không còn gánh JSON trả về

    try {
        await client.connect();
        const collection = client.db("user-service").collection("User");
        const cursor = collection.find(
            { profile_vector: { $exists: false } },
            { projection: { _id: 1, bio: 1, age: 1 } }
        ).batchSize(BATCH_SIZE);

        let batch = [];
        console.time("SpeedTest");

        while (await cursor.hasNext()) {
            const user = await cursor.next();
            batch.push({ id: user._id.toString(), bio: user.bio || "", age: user.age || 0 });

            if (batch.length === BATCH_SIZE) {
                // Chỉ gửi đi, không cần xử lý kết quả trả về nặng nề
                console.time("PythonRequest");
                await axios.post("http://127.0.0.1:8000/embed-and-save", { users: batch });
                batch = [];
                console.timeEnd("PythonRequest");
                console.log(`🚀 Đã đẩy ${BATCH_SIZE} users sang Python... `);
            }
        }
        console.timeEnd("SpeedTest");
    } finally {
        await client.close();
    }
}
run();