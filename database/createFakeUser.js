// ==========================================
// 1. TỪ ĐIỂN DỮ LIỆU (DICTIONARIES)
// ==========================================

// Tên người Việt Nam (Để sinh Email cho chuẩn)
const firstNames = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Phan", "Vũ", "Võ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô", "Dương", "Lý"];
const middleNames = ["Văn", "Thị", "Thanh", "Minh", "Hữu", "Đức", "Ngọc", "Hoài", "Thu", "Xuân", "Thành", "Hải"];
const lastNames = ["An", "Anh", "Bảo", "Bình", "Cường", "Châu", "Dương", "Dũng", "Giang", "Hải", "Hà", "Hùng", "Hương", "Khang", "Khánh", "Linh", "Lan", "Minh", "Nga", "Nguyên", "Nhung", "Phúc", "Phương", "Quân", "Quỳnh", "Sơn", "Thảo", "Trang", "Tùng", "Tuấn", "Uyên", "Vinh", "Vy", "Yến"];

const cities = ["Hà Nội", "TP. Hồ Chí Minh", "Đà Nẵng", "Cần Thơ", "Hải Phòng", "Đà Lạt", "Vũng Tàu", "Nha Trang", "Bắc Ninh", "Bình Dương", "Đồng Nai"];

const generatedUsernames = new Set();
const generatedEmails = new Set();

const cityCoordinates = {
    "Hà Nội": { lat: 21.028511, lon: 105.804817 },
    "TP. Hồ Chí Minh": { lat: 10.823099, lon: 106.629662 },
    "Đà Nẵng": { lat: 16.054407, lon: 108.202164 },
    "Cần Thơ": { lat: 10.045162, lon: 105.746857 },
    "Hải Phòng": { lat: 20.844912, lon: 106.688084 },
    "Đà Lạt": { lat: 11.940419, lon: 108.458313 },
    "Vũng Tàu": { lat: 10.345990, lon: 107.084260 },
    "Nha Trang": { lat: 12.238791, lon: 109.196749 },
    "Bắc Ninh": { lat: 21.186080, lon: 106.076310 },
    "Bình Dương": { lat: 11.166667, lon: 106.666667 },
    "Đồng Nai": { lat: 10.933333, lon: 107.133333 }
};

const orgs = ["Phenikaa University", "Đại học Bách Khoa", "Đại học Kinh tế Quốc dân", "Đại học Y Hà Nội", "Vingroup", "Shopee", "Vietcombank", "Bệnh viện Chợ Rẫy", "Đài Truyền hình VN", "Freelance", "Highlands Coffee", "KPMG", "FPT Software"];

const hobbies = ["đi cà phê lề đường", "chơi hệ tâm linh (Tarot)", "nuôi mèo", "nuôi chó corgi", "đu idol Kpop", "đi phượt Tây Bắc", "tập Pilates", "chạy bộ hồ Tây", "đọc sách self-help", "nghe podcast", "sưu tầm đồ cổ", "chơi mô hình Gundam", "đi đu đưa đi", "nấu ăn"];

const publicDomains = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"];

const orgDomains = {
    "Phenikaa University": "phenikaa-uni.edu.vn", "Đại học Bách Khoa": "hust.edu.vn",
    "Đại học Kinh tế Quốc dân": "neu.edu.vn", "Đại học Y Hà Nội": "hmu.edu.vn",
    "Vingroup": "vingroup.net", "Shopee": "shopee.vn", "Vietcombank": "vcb.com.vn",
    "FPT Software": "fsoft.com.vn", "KPMG": "kpmg.com.vn", "Freelance": null, "Highlands Coffee": null 
};

const professionDomains = {
    "Kinh_Te_Tai_Chinh": {
        roles: ["Chuyên viên tín dụng", "Kế toán viên", "Nhân viên Sale", "Data Analyst", "Giám đốc tài chính"],
        tools: ["Excel", "SAP", "MISA", "PowerBI", "CRM", "Google Sheets"],
        verbs: ["chạy KPI", "chốt sale", "làm báo cáo", "cày số", "gọi telesale", "cân bằng sổ sách"]
    },
    "Nghe_Thuat_Sang_Tao": {
        roles: ["Graphic Designer", "Content Creator", "Tiktoker", "Photographer", "Copywriter"],
        tools: ["Photoshop", "Premiere", "Canva", "Figma", "Máy ảnh Sony", "CapCut"],
        verbs: ["chạy deadline thiết kế", "dựng clip", "săn idea", "quay vlog", "viết content", "địt pixel"]
    },
    "Y_Te_Suc_Khoe": {
        roles: ["Bác sĩ đa khoa", "Điều dưỡng", "Dược sĩ", "Bác sĩ thú y"],
        tools: ["Tai nghe y tế", "Máy siêu âm", "Đơn thuốc", "Kim tiêm"],
        verbs: ["trực ca đêm", "khám bệnh", "phát thuốc", "viết bệnh án", "cấp cứu"]
    },
    "Giao_Duc": {
        roles: ["Giáo viên cấp 3", "Giảng viên đại học", "Gia sư", "Chuyên viên đào tạo"],
        tools: ["PowerPoint", "Phấn bảng", "Google Meet", "Giáo án", "Zoom"],
        verbs: ["soạn bài giảng", "chấm thi trắc nghiệm", "gõ đầu trẻ", "canh thi", "lên lớp"]
    },
    "Ky_Thuat_Xay_Dung": {
        roles: ["Kiến trúc sư", "Kỹ sư cơ khí", "Kỹ sư xây dựng", "Giám sát công trình"],
        tools: ["AutoCAD", "Revit", "Bản vẽ 3D", "Máy CNC", "Máy thủy bình"],
        verbs: ["chạy hiện trường", "vẽ bản vẽ", "đổ bê tông", "chửi thầu phụ", "đo đạc"]
    },
    "IT_Tech": {
        roles: ["Software Engineer", "DevOps", "Tester", "Product Manager", "Sinh viên IT"],
        tools: ["VS Code", "Docker", "Jira", "AWS", "Figma", "Git", "NestJS"],
        verbs: ["fix bug", "deploy server", "test app", "viết tài liệu", "cãi nhau với QC"]
    }
};

const bioTemplates = {
    "GenZ_Votri": [
        "Làm {role} vì dòng đời xô đẩy, chứ đam mê thực sự là {hobby}. 🥲",
        "Hệ điều hành chạy bằng {hobby}. Trầm cảm vì {verb} bằng {tools} mỗi ngày.",
        "Sáng làm {role} tử tế tại {org}, tối về hiện nguyên hình đi {hobby}. Đang cần healing."
    ],
    "Introvert": [
        "Một tâm hồn tĩnh lặng giữa {city}. Yêu {hobby} và thích làm việc với {tools}.",
        "Thế giới của mình quẩn quanh việc {verb} và {hobby}. Hiện đang công tác tại {org}.",
        "Làm {role} nhưng mang tâm hồn nghệ sĩ. Cuối tuần thường {hobby} để nạp lại năng lượng."
    ],
    "Workaholic": [
        "{role} đam mê công việc. Thích cảm giác {verb} xuyên đêm bằng {tools}.",
        "Sống bằng nghề {role}, thở bằng {tools}. Mục tiêu tuổi trẻ là cống hiến tại {org}.",
        "Bán mình cho tư bản tại {org}. Chuyên môn: {verb}. Inbox nếu bạn cùng tần số nhé!"
    ],
    "Professional": [
        "Chào mọi người, mình là {role} với 3 năm kinh nghiệm. Thế mạnh: {tools}.",
        "Đang làm việc tại {org} chi nhánh {city}. Rất quan tâm đến việc {verb}. Rất vui được kết nối!",
        "Chuyên gia trong lĩnh vực {tools}. Ngoài giờ hành chính, mình thích {hobby}."
    ]
};

// ==========================================
// 2. CÁC HÀM TIỆN ÍCH (HELPER FUNCTIONS)
// ==========================================

const getRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

function removeVietnameseTones(str) {
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g,"a"); 
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g,"e"); 
    str = str.replace(/ì|í|ị|ỉ|ĩ/g,"i"); 
    str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g,"o"); 
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g,"u"); 
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g,"y"); 
    str = str.replace(/đ/g,"d");
    str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
    str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
    str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
    str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
    str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
    str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
    str = str.replace(/Đ/g, "D");
    return str.toLowerCase();
}

function getRandomLocation(centerLat, centerLon, radiusInKm) {
    const radiusInDegrees = radiusInKm / 111.3;
    const u = Math.random();
    const v = Math.random();
    const w = radiusInDegrees * Math.sqrt(u);
    const t = 2 * Math.PI * v;
    const offsetX = w * Math.cos(t);
    const offsetY = w * Math.sin(t);
    const newLon = offsetX / Math.cos(centerLat * Math.PI / 180) + centerLon;
    const newLat = offsetY + centerLat;
    return { lat: Number(newLat.toFixed(6)), lon: Number(newLon.toFixed(6)) };
}

function generateSmartEmail(fullName, organization) {
    const cleanName = removeVietnameseTones(fullName);
    const words = cleanName.split(' ');
    const firstName = words[words.length - 1];
    const lastName = words[0];
    const middleInitial = words.length > 2 ? words[1][0] : "";
    
    const prefixFormats = [
        `${firstName}.${lastName}`, `${firstName}${lastName[0]}${middleInitial}`,
        cleanName.replace(/\s/g, ''), `${firstName}${Math.floor(Math.random() * 9999)}`
    ];
    let prefix = getRandom(prefixFormats);

    let domain = "";
    const isWorkEmail = Math.random() < 0.3; // 30% xài mail công ty
    const orgDomain = orgDomains[organization];

    if (isWorkEmail && orgDomain) {
        domain = orgDomain;
    } else {
        domain = getRandom(publicDomains);
    }
    return `${prefix}@${domain}`;
}

// Hàm loại bỏ dấu tiếng Việt (đã có ở file trước)
function removeVietnameseTones(str) {
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g,"a").replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g,"e").replace(/ì|í|ị|ỉ|ĩ/g,"i").replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g,"o").replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g,"u").replace(/ỳ|ý|ỵ|ỷ|ỹ/g,"y").replace(/đ/g,"d");
    return str.toLowerCase();
}

/**
 * Sinh username dựa trên Tên thật
 * @param {string} fullName - Tên đầy đủ (VD: Nguyễn Văn An)
 * @param {number} age - Tuổi (Dùng để suy ra năm sinh)
 */
function generateNameBasedUsername(fullName, age) {
    const cleanName = removeVietnameseTones(fullName);
    const words = cleanName.split(' ');
    
    const firstName = words[words.length - 1]; // "an"
    const lastName = words[0]; // "nguyen"
    const middleInitial = words.length > 2 ? words[1][0] : ""; // "v"
    
    // Tính năm sinh để làm đuôi username (VD: 2026 - 20 = 2006)
    const birthYear = new Date().getFullYear() - age;
    const shortYear = String(birthYear).slice(-2); // Lấy 2 số cuối: "06"

    const patterns = [
        cleanName.replace(/\s/g, ''),                  // nguyenvanan
        `${firstName}.${lastName}`,                    // an.nguyen
        `${lastName}_${firstName}`,                    // nguyen_an
        `${firstName}${lastName[0]}${middleInitial}`,  // anv
        `${firstName}${birthYear}`,                    // an2006
        `${firstName}${shortYear}`,                    // an06
        `${firstName}_${Math.floor(Math.random() * 999)}` // an_827 (Tăng độ ngẫu nhiên)
    ];

    return patterns[Math.floor(Math.random() * patterns.length)];
}

// Test:
console.log(generateNameBasedUsername("Nguyễn Văn An", 22)); 
// Kết quả ngẫu nhiên: an.nguyen, nguyenvanan, an04...

// ==========================================
// 3. HÀM CHÍNH: SINH TOÀN BỘ THÔNG TIN USER
// ==========================================

// ==========================================
// 3. HÀM CHÍNH: SINH TOÀN BỘ THÔNG TIN USER (BẢO ĐẢM UNIQUE)
// ==========================================

function generateCompleteUser() {
    // 1. Sinh Tên, Tổ chức, Vị trí
    const fullName = `${getRandom(firstNames)} ${getRandom(middleNames)} ${getRandom(lastNames)}`;
    const selectedOrg = getRandom(orgs);
    const selectedCity = getRandom(cities);
    const cityCoord = cityCoordinates[selectedCity];
    const location = getRandomLocation(cityCoord.lat, cityCoord.lon, 15);
    const age = Math.floor(Math.random() * 22) + 18; // 18 - 39 tuổi

    // ----------------------------------------------------
    // XỬ LÝ UNIQUE USERNAME
    // ----------------------------------------------------
    let username = generateNameBasedUsername(fullName, age);
    let uCounter = 1;
    // Nếu username đã tồn tại trong Set, thêm số vào đuôi và check lại
    while (generatedUsernames.has(username)) {
        username = `${generateNameBasedUsername(fullName, age)}_${uCounter}`;
        uCounter++;
    }
    // Ghi nhận vào Set để những người sau không được trùng
    generatedUsernames.add(username);


    // ----------------------------------------------------
    // XỬ LÝ UNIQUE EMAIL
    // ----------------------------------------------------
    let email = generateSmartEmail(fullName, selectedOrg);
    let eCounter = 1;
    // Nếu email đã tồn tại, chèn thêm số vào TRƯỚC dấu @
    while (generatedEmails.has(email)) {
        const parts = email.split('@');
        email = `${parts[0]}${eCounter}@${parts[1]}`;
        eCounter++;
    }
    // Ghi nhận vào Set
    generatedEmails.add(email);


    // ----------------------------------------------------
    // Xử lý Bio
    const domainKeys = Object.keys(professionDomains);
    const selectedDomain = professionDomains[getRandom(domainKeys)]; 
    const templateKeys = Object.keys(bioTemplates);
    const selectedPersonality = getRandom(templateKeys); 
    
    let bio = getRandom(bioTemplates[selectedPersonality]);
    bio = bio.replace("{role}", getRandom(selectedDomain.roles));
    bio = bio.replace("{tools}", getRandom(selectedDomain.tools)); 
    bio = bio.replace("{tools}", getRandom(selectedDomain.tools)); 
    bio = bio.replace("{verb}", getRandom(selectedDomain.verbs));
    bio = bio.replace("{hobby}", getRandom(hobbies));
    bio = bio.replace("{org}", selectedOrg); 
    bio = bio.replace("{city}", selectedCity); 

    // ----------------------------------------------------
    // TRẢ VỀ KẾT QUẢ ĐÃ ĐƯỢC BẢO CHỨNG UNIQUE 100%
    return {
        fullName: fullName,
        username: username, // Chắc chắn Unique
        email: email,       // Chắc chắn Unique
        age: age, 
        city: selectedCity,
        lat: location.lat,
        lon: location.lon,
        bio: bio,
        lastSeen: null,
        isActive: true,
        avatar: null,
    };
}

// ==========================================
// 5. THỰC THI CHÈN VÀO MONGODB (BULK INSERT)
// ==========================================

const TOTAL_USERS = 1000000;
const BATCH_SIZE = 10000; // Mỗi mẻ 10.000 người
let batchArray = [];
let totalInserted = 0;

print("🚀 Bắt đầu sinh và nạp 1 TRIỆU dữ liệu...");
const startTime = new Date();

for (let i = 0; i < TOTAL_USERS; i++) {
    // NHỚ CÓ DẤU (): Gọi hàm để lấy ra Object User
    const newUser = generateCompleteUser(); 
    batchArray.push(newUser);

    // Khi xe tải (Array) đã chứa đủ 10.000 người -> Đem đi Insert
    if (batchArray.length === BATCH_SIZE) {
        // Tham số { ordered: false } giúp MongoDB chèn đa luồng song song cực nhanh
        db.User.insertMany(batchArray, { ordered: false }); 
        
        totalInserted += BATCH_SIZE;
        print(`✅ Đã nạp thành công: ${totalInserted} / ${TOTAL_USERS} users`);
        
        // Đổ rác, làm trống xe tải để chở mẻ tiếp theo
        batchArray = []; 
    }
}

// Chèn nốt số dữ liệu lẻ (nếu có)
if (batchArray.length > 0) {
    db.User.insertMany(batchArray, { ordered: false });
    totalInserted += batchArray.length;
    print(`✅ Đã nạp thành công: ${totalInserted} / ${TOTAL_USERS} users`);
}

const endTime = new Date();
const timeTaken = (endTime - startTime) / 1000; // Tính bằng giây

print(`🎉 HOÀN TẤT! Đã nạp xong 1 triệu người dùng trong ${timeTaken} giây.`);