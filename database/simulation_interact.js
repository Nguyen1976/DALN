(() => {
    print("🚀 Đang chạy script update action giả lập cho dữ liệu hiện tại...");

    const collectionName = "impresstionLog"; // Đổi thành actionLog nếu bạn tách collection
    const batchSize = 1000;

    // Trọng số định hướng
    const W_FRIENDS = 0.5;
    const W_GROUPS = 0.3;
    const W_INTEREST = 0.8;
    const W_DISTANCE = -0.1; 
    const BASE_INTERCEPT = -3.0; // Ép tỷ lệ IGNORE lên mức thực tế (80-90%)

    // Hàm tạo nhiễu cảm xúc (Phân phối chuẩn Normal - Thuật toán Box-Muller)
    function getNormal(mean, stdDev) {
        let u = 1 - Math.random(); 
        let v = Math.random();
        let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        return z * stdDev + mean;
    }

    const cursor = db.getCollection(collectionName).find({version: 2});
    let bulkOps = [];
    let stats = { IGNORE: 0, MESSAGE: 0, FRIEND: 0 };
    let count = 0;

    cursor.forEach(doc => {
        // Bỏ qua nếu doc không có object features
        if (!doc.features) return; 

        const friends = doc.features.mutualFriends || 0;
        const groups = doc.features.mutualGroups || 0;
        const interest = doc.features.interestSimilarity || 0;
        const distance = doc.features.distanceKm || 0;

        // Tính điểm tuyến tính z ban đầu
        let z = (W_FRIENDS * friends) + 
                (W_GROUPS * groups) + 
                (W_INTEREST * interest) + 
                (W_DISTANCE * distance) + 
                BASE_INTERCEPT;

        // Thêm nhiễu ngẫu nhiên
        z += getNormal(0.0, 1.5);

        // Tính xác suất P
        let prob = 1 / (1 + Math.exp(-z));
        let newAction = "IGNORE";

        // Tung đồng xu
        if (Math.random() < prob) {
            newAction = Math.random() < 0.7 ? "MESSAGE" : "FRIEND";
        }
        
        stats[newAction]++;

        // Đẩy lệnh update vào Bulk
        bulkOps.push({
            updateOne: {
                filter: { _id: doc._id },
                update: { $set: { action: newAction } }
            }
        });

        count++;

        // Flush batch
        if (count % batchSize === 0) {
            db.getCollection(collectionName).bulkWrite(bulkOps);
            print(`⏳ Đã update ${count} records...`);
            bulkOps = []; 
        }
    });

    // Flush nốt phần dư
    if (bulkOps.length > 0) {
        db.getCollection(collectionName).bulkWrite(bulkOps);
    }

    // In báo cáo
    print("\n✅ === HOÀN TẤT ===");
    if (count > 0) {
        print(`Đã update action cho ${count} bản ghi có sẵn trong collection '${collectionName}'.`);
        print("📊 Tỷ lệ phân bổ Action sau khi update:");
        print(`   - IGNORE : ${stats.IGNORE} (${((stats.IGNORE / count) * 100).toFixed(2)}%)`);
        print(`   - MESSAGE: ${stats.MESSAGE} (${((stats.MESSAGE / count) * 100).toFixed(2)}%)`);
        print(`   - FRIEND : ${stats.FRIEND} (${((stats.FRIEND / count) * 100).toFixed(2)}%)`);
    } else {
        print("⚠️ Không tìm thấy document nào có trường 'features' để update.");
    }
})();