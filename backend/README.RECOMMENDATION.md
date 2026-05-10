# Recommendation Service - System Design

Tài liệu này mô tả thiết kế recommendation service theo hướng mục tiêu. Đây là spec cho AI và người maintain hệ thống, nên có thể chứa phần chưa được triển khai đầy đủ trong code hiện tại. Nguyên tắc là: không để AI hiểu nhầm rằng các cross-service join trực tiếp đang được phép.

## 1. Nguyên tắc kiến trúc

Recommendation service là một microservice độc lập. Nó không query trực tiếp DB của user-service hay friend-service.

Thay vào đó dùng local replica pattern:

user-service DB -> RabbitMQ/Kafka -> recommendation-service DB
friend-service DB -> RabbitMQ/Kafka -> recommendation-service DB

Ý nghĩa của kiến trúc này:

1. Recommendation service chỉ đọc dữ liệu replica riêng của nó.
2. Mọi dữ liệu cần cho recommendation phải được sync qua event hoặc message queue.
3. Không join sang DB của service khác trong runtime recommendation.
4. Replica chỉ lưu field cần thiết cho ranking và training.

## 2. Prisma Schema - Recommendation Service

Schema bên dưới là khung mục tiêu cho recommendation-service.

Prisma generator:

```text
generator client {
   provider      = "prisma-client-js"
   output        = "../src/generated"
   binaryTargets = ["native", "linux-musl-openssl-3.0.x", "debian-openssl-3.0.x"]
}
```

Datasource:

```text
datasource db {
   provider = "mongodb"
   url      = env("DATABASE_URL")
}
```

### 2.1. Local replica - UserSnapshot

Chỉ lưu field cần thiết cho recommendation. Không join sang user-service DB.

```text
model UserSnapshot {
   id          String    @id @map("_id") @db.ObjectId
   username    String
   fullName    String
   avatar      String?
   bio         String?
   interests   String[]
   location    Json?
   isActive    Boolean   @default(true)
   lastSeen    DateTime?
   syncedAt    DateTime  @default(now())
   createdAt   DateTime  @default(now())

   @@index([interests])
   @@index([location], map: "location_2dsphere")
   @@index([isActive, lastSeen])
   @@index([syncedAt])
}
```

### 2.2. InterestTag - master data

Seed một lần, admin có thể thêm sau.

```text
model InterestTag {
   id       String @id @default(auto()) @map("_id") @db.ObjectId
   slug     String @unique
   label    String
   emoji    String
   category String
   order    Int    @default(0)
   isActive Boolean @default(true)
}
```

### 2.3. ImpressionLog - core data cho training

Feature set của impression log:

```text
type Features {
   mutualFriends       Int
   mutualGroups        Int
   interestSimilarity   Float
   bioSimilarity        Float
   distanceKm           Float
   sameCity             Int
   avatarExists         Int
   bioLength            Int
   profileCompleteness  Float
   accountAgeDays       Int
}
```

Action enum:

```text
enum Action {
   MESSAGE
   FRIEND
   IGNORE
}
```

Impression log:

```text
model ImpressionLog {
   id           String   @id @default(auto()) @map("_id") @db.ObjectId
   userId       String   @db.ObjectId
   candidateId  String   @db.ObjectId
   features     Features
   score        Float
   rank         Int
   action       Action   @default(IGNORE)
   modelVersion String?
   dayVersion   Int
   createdAt    DateTime @default(now())

   @@index([userId, dayVersion])
   @@index([dayVersion, action])
   @@index([userId, candidateId])
}
```

### 2.4. ModelRegistry - theo dõi model tốt nhất

Model types:

```text
enum ModelType {
   XGBOOST
   RANDOM_FOREST
   LOGISTIC_REGRESSION
   RULE_BASED
}
```

Model status:

```text
enum ModelStatus {
   TRAINING
   EVALUATING
   ACTIVE
   RETIRED
   FAILED
}
```

Model registry:

```text
model ModelRegistry {
   id            String      @id @default(auto()) @map("_id") @db.ObjectId
   modelType     ModelType
   modelFile     String
   dayVersion    Int
   status        ModelStatus @default(TRAINING)
   prAuc         Float?
   rocAuc        Float?
   f1            Float?
   precision     Float?
   recall        Float?
   threshold     Float?
   trainRows     Int?
   positiveRows   Int?
   trainedAt     DateTime?
   activatedAt   DateTime?
   createdAt     DateTime    @default(now())
   updatedAt     DateTime    @updatedAt

   @@index([status, createdAt])
   @@index([dayVersion])
}
```

### 2.5. RecommendationResult - cache kết quả gợi ý

TTL 24h, refresh theo cronjob hàng ngày.

```text
model RecommendationResult {
   id           String   @id @default(auto()) @map("_id") @db.ObjectId
   userId       String   @db.ObjectId @unique
   candidates   Json
   modelVersion String
   dayVersion   Int
   expiresAt    DateTime
   createdAt    DateTime @default(now())
   updatedAt    DateTime @updatedAt

   @@index([userId])
   @@index([expiresAt])
   @@index([dayVersion])
}
```

## 3. Event-driven Sync Architecture

Recommendation service nhận event từ user-service và friend-service, rồi sync vào local replica.

### 3.1. user.created

Khi user được tạo mới, tạo snapshot ban đầu.

```text
@EventPattern('user.created')
async onUserCreated(payload: UserCreatedEvent) {
   await this.snapshotService.upsert({
      id: payload.userId,
      username: payload.username,
      fullName: payload.fullName,
      avatar: payload.avatar,
      bio: payload.bio,
      interests: [],
      location: null,
      isActive: true,
      syncedAt: new Date()
   });
}
```

### 3.2. user.interests.updated

Khi user chọn xong interest ở onboarding stage 2, cập nhật snapshot và trigger cold-start recommendation ngay.

```text
@EventPattern('user.interests.updated')
async onInterestsUpdated(payload: InterestsUpdatedEvent) {
   await this.snapshotService.update(payload.userId, {
      interests: payload.interests,
      syncedAt: new Date()
   });

   await this.recommendationQueue.add('cold-start', {
      userId: payload.userId
   }, { priority: 1 });
}
```

### 3.3. user.location.updated

```text
@EventPattern('user.location.updated')
async onLocationUpdated(payload: LocationUpdatedEvent) {
   await this.snapshotService.update(payload.userId, {
      location: {
         lat: payload.lat,
         lon: payload.lon,
         country: payload.country,
         city: payload.city,
         district: payload.district,
      },
      syncedAt: new Date()
   });
}
```

### 3.4. user.profile.updated

```text
@EventPattern('user.profile.updated')
async onProfileUpdated(payload: ProfileUpdatedEvent) {
   await this.snapshotService.update(payload.userId, {
      avatar: payload.avatar,
      bio: payload.bio,
      fullName: payload.fullName,
      syncedAt: new Date()
   });

   await this.cacheService.del(`user:${payload.userId}:features`);
}
```

### 3.5. friendship.created

Friend graph được sync sang Neo4j để phục vụ mutual friend / mutual group.

```text
@EventPattern('friendship.created')
async onFriendshipCreated(payload: FriendshipCreatedEvent) {
   await this.neo4jService.createFriendship(
      payload.userId,
      payload.friendId
   );
}
```

## 4. Location Design

Thiết kế location cần hỗ trợ cả hai hướng:

1. Tọa độ trực tiếp để tính khoảng cách bằng Haversine.
2. Location hierarchy để tính sameCity, sameDistrict mà không cần tính distance.

Type location:

```text
export interface UserLocation {
   lat: number;
   lon: number;
   country: string;
   city: string;
   district: string;
   ward?: string;
}
```

Haversine dùng cho `distanceKm`.

Same city check dùng hierarchy.

## 5. Daily Version Strategy

Version theo ngày giúp trace được data và model được sinh từ hôm nào.

```text
export function getDayVersion(): number {
   const d = new Date();
   return d.getFullYear() * 10000 +
             (d.getMonth() + 1) * 100 +
             d.getDate();
}
```

Mỗi cronjob hàng ngày chạy với `dayVersion = getDayVersion()`. Tất cả ImpressionLog và RecommendationResult trong ngày đó phải gắn cùng version.

## 6. Model Learning Loop - Cronjob hàng ngày

Chu kỳ mục tiêu:

- 00:00: cronjob chạy recommendation cho toàn bộ user với dayVersion mới.
- 02:00: đủ log của ngày hôm qua thì trigger retrain pipeline.

Pipeline retrain:

1. Lấy ImpressionLog theo dayVersion hôm qua.
2. Check threshold tối thiểu, ví dụ positive rows >= 10k.
3. Train 3 model song song.
4. Evaluate và chọn model có PR-AUC cao nhất.
5. Ghi ModelRegistry: model cũ chuyển sang RETIRED, model mới chuyển sang ACTIVE.
6. Python service load model mới để predict.

Mục tiêu là vòng lặp học liên tục, không phụ thuộc vào manual selection.

## 7. Dependency summary của recommendation-service

| Dependency     | Dùng để làm gì                                                   | Ghi chú                      |
| -------------- | ---------------------------------------------------------------- | ---------------------------- |
| MongoDB riêng  | UserSnapshot, ImpressionLog, ModelRegistry, RecommendationResult | Không share với service khác |
| Neo4j          | Graph friends, mutual friends 2-hop                              | Sync qua event               |
| Qdrant         | Interest và bio embedding similarity                             | Upsert khi user update       |
| Redis          | Feature hydration cache                                          | TTL 6h                       |
| RabbitMQ/Kafka | Nhận event từ user-service và friend-service                     | Không query trực tiếp        |
| Python service | Train, evaluate, predict                                         | Giao tiếp qua HTTP nội bộ    |

## 8. Tóm tắt cho AI

Điểm quan trọng nhất là recommendation-service phải là local-replica microservice, không join trực tiếp vào DB của service khác. Dữ liệu cần được sync bằng event. Candidate generation, location feature, daily versioning, impression log, và model registry đều phải được thiết kế để phục vụ cold-start và vòng lặp học hàng ngày.

Thiết kế này có thể chưa khớp 100% với code hiện tại, nhưng nó đang đi đúng hướng mà hệ thống cần.
