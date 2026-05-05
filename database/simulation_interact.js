(() => {
    print("🚀 Simulation v2 - Strong signal version");

    const collectionName = "impresstionLog";
    const batchSize = 1000;

    function getNormal(mean, stdDev) {
        let u = 1 - Math.random();
        let v = Math.random();
        let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        return z * stdDev + mean;
    }

    // ✅ Normalize distance về 0-1 trước khi dùng
    function normalizeDistance(km) {
        // 0km = 1.0, 50km = 0.5, 200km+ ≈ 0
        return Math.exp(-km / 50);
    }

    // ✅ Normalize mutualFriends về 0-1
    function normalizeFriends(count) {
        // 0 = 0, 5 = 0.5, 10+ ≈ 1.0
        return 1 - Math.exp(-count / 5);
    }

    // ✅ Normalize mutualGroups về 0-1
    function normalizeGroups(count) {
        return 1 - Math.exp(-count / 3);
    }

    const cursor = db.getCollection(collectionName).find({ version: 3 });
    let bulkOps = [];
    let stats = { IGNORE: 0, MESSAGE: 0, FRIEND: 0 };
    let count = 0;

    cursor.forEach(doc => {
        if (!doc.features) return;

        const friends  = normalizeFriends(doc.features.mutualFriends || 0);   // 0-1
        const groups   = normalizeGroups(doc.features.mutualGroups || 0);     // 0-1
        const interest = doc.features.interestSimilarity || 0;                // đã 0-1
        const distance = normalizeDistance(doc.features.distanceKm || 999);   // 0-1

        // ✅ Weight mạnh hơn, tất cả features đã cùng scale 0-1
        // BASE_INTERCEPT = -3.5 → P(positive) ≈ 1% khi tất cả = 0
        let z = (1.5 * friends)   // bạn chung: signal mạnh nhất
               + (0.8 * groups)   // nhóm chung
               + (1.8 * interest) // sở thích: signal mạnh
               + (0.6 * distance) // gần nhau
               + (-3.5);          // intercept

        // ✅ Noise nhỏ hơn để không overwhelm signal
        z += getNormal(0.0, 0.1);

        const prob = 1 / (1 + Math.exp(-z));
        let newAction = "IGNORE";

        if (Math.random() < prob) {
            newAction = Math.random() < 0.7 ? "MESSAGE" : "FRIEND";
        }

        stats[newAction]++;
        bulkOps.push({
            updateOne: {
                filter: { _id: doc._id },
                update: { $set: { action: newAction } }
            }
        });

        count++;
        if (count % batchSize === 0) {
            db.getCollection(collectionName).bulkWrite(bulkOps);
            print(`⏳ Đã update ${count} records...`);
            bulkOps = [];
        }
    });

    if (bulkOps.length > 0) {
        db.getCollection(collectionName).bulkWrite(bulkOps);
    }

    print("\n✅ === HOÀN TẤT ===");
    if (count > 0) {
        print(`Updated: ${count} records`);
        print(`   IGNORE : ${stats.IGNORE} (${((stats.IGNORE/count)*100).toFixed(1)}%)`);
        print(`   MESSAGE: ${stats.MESSAGE} (${((stats.MESSAGE/count)*100).toFixed(1)}%)`);
        print(`   FRIEND : ${stats.FRIEND} (${((stats.FRIEND/count)*100).toFixed(1)}%)`);
    }
})();