(() => {

  const collectionName = "impresstionLog";
  const batchSize = 1000;
  const totalRecords = 1000000;

  // Dùng userId/candidateId thật từ DB để tránh orphan data
  const userIds = db
    .getCollection("User")
    .aggregate([{ $sample: { size: 500 } }, { $project: { _id: 1 } }])
    .map((u) => u._id);

  if (userIds.length === 0) {
    print("❌ Không tìm thấy users!");
    return;
  }

  print(`✅ Loaded ${userIds.length} users`);

  // Helper functions
  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function randInt(min, max) {
    return Math.floor(rand(min, max + 1));
  }

  function getNormal(mean, std) {
    let u = 1 - Math.random();
    let v = Math.random();
    let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * std + mean;
  }

  function normalizeFriends(n) {
    return 1 - Math.exp(-n / 5);
  }
  function normalizeGroups(n) {
    return 1 - Math.exp(-n / 3);
  }
  function normalizeDist(km) {
    return Math.exp(-km / 50);
  }

  function simulateAction(friends, groups, interest, distKm) {
    const f = normalizeFriends(friends);
    const g = normalizeGroups(groups);
    const d = normalizeDist(distKm);

    let z =
      1.5 * f + 0.8 * g + 1.8 * interest + 0.6 * d + -3.5 + getNormal(0, 0.1);

    const prob = 1 / (1 + Math.exp(-z));
    if (Math.random() < prob) {
      return Math.random() < 0.7 ? "MESSAGE" : "FRIEND";
    }
    return "IGNORE";
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // 4 clusters để tạo distribution đa dạng
  function generateFeatures() {
    const roll = Math.random();

    if (roll < 0.1) {
      // Cluster 1: Close friends — 10% records
      return {
        mutualFriends: randInt(5, 20),
        mutualGroups: randInt(2, 8),
        interestSimilarity: rand(0.6, 1.0),
        distanceKm: rand(0, 20),
      };
    } else if (roll < 0.25) {
      // Cluster 2: Same interest — 15% records
      return {
        mutualFriends: randInt(0, 3),
        mutualGroups: randInt(1, 5),
        interestSimilarity: rand(0.5, 0.9),
        distanceKm: rand(0, 100),
      };
    } else if (roll < 0.35) {
      // Cluster 3: Nearby strangers — 10% records
      return {
        mutualFriends: randInt(0, 2),
        mutualGroups: randInt(0, 2),
        interestSimilarity: rand(0.1, 0.5),
        distanceKm: rand(0, 15),
      };
    } else {
      // Cluster 4: Pure strangers — 65% records (majority)
      return {
        mutualFriends: randInt(0, 1),
        mutualGroups: 0,
        interestSimilarity: rand(0.0, 0.3),
        distanceKm: rand(50, 500),
      };
    }
  }

  // Generate
  let bulkOps = [];
  let stats = { IGNORE: 0, MESSAGE: 0, FRIEND: 0 };
  const version = 3; // version mới để tách biệt với data cũ

  for (let i = 0; i < totalRecords; i++) {
    const features = generateFeatures();
    const action = simulateAction(
      features.mutualFriends,
      features.mutualGroups,
      features.interestSimilarity,
      features.distanceKm,
    );

    stats[action]++;

    const userId = pickRandom(userIds);
    const candidateId = pickRandom(userIds);

    bulkOps.push({
      insertOne: {
        document: {
          userId: userId,
          candidateId: candidateId,
          features: features,
          action: action,
          score: parseFloat(rand(0.1, 0.99).toFixed(2)),
          rank: randInt(1, 100),
          version: version,
          createdAt: new Date(),
        },
      },
    });

    if (bulkOps.length >= batchSize) {
      db.getCollection(collectionName).bulkWrite(bulkOps);
      if (i % 10000 === 0) print(`⏳ ${i}/${totalRecords} records...`);
      bulkOps = [];
    }
  }

  if (bulkOps.length > 0) {
    db.getCollection(collectionName).bulkWrite(bulkOps);
  }

  const total = stats.IGNORE + stats.MESSAGE + stats.FRIEND;
  print("\n✅ === HOÀN TẤT ===");
  print(`Total: ${total} records (version ${version})`);
  print(
    `IGNORE : ${stats.IGNORE} (${((stats.IGNORE / total) * 100).toFixed(1)}%)`,
  );
  print(
    `MESSAGE: ${stats.MESSAGE} (${((stats.MESSAGE / total) * 100).toFixed(1)}%)`,
  );
  print(
    `FRIEND : ${stats.FRIEND} (${((stats.FRIEND / total) * 100).toFixed(1)}%)`,
  );
})();
