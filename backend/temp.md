luồng của mình sẽ là sau khi chọn interest xong thì server sẽ xử lý tạo candidate như trong recommend service t đã từng làm mục tiêu là cho mỗi user đấy và version là 1 NguồnSố lượngQueryFriends of friends100Neo4j 2-hop graphInterest similarity80Qdrant vector search theo interest embeddingGeo nearby50MongoDB $geoNear trên UserSnapshotBio similarity30Qdrant vector search theo bio embedding Union tất cả candidate, deduplicate theo userId
Loại bỏ: bản thân user, bạn bè hiện tại (query Neo4j), user isActive=false
Trả về tối đa 200 candidate ID
Nếu user chưa có location thì bỏ qua nguồn Geo
Nếu user chưa có bio thì bỏ qua nguồn Bio similarity nên bám theo logic có sẵn 